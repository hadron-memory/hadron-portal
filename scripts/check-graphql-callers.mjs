// Caller-side half of the GraphQL gate (#681 follow-up).
//
// `validate-graphql.mjs` proves each DOCUMENT is valid against the schema. It
// says nothing about the object a caller actually passes as variables — and a
// `$variable` is internal to the document, so renaming `$id` to `$ref` keeps the
// document valid while every caller still sending `{ id }` breaks at RUNTIME
// with `Variable "$ref" of required type "ID!" was not provided`.
//
// That is the exact failure mode the write-surface `$variable` sweep could have
// introduced across ~64 files, so this module closes it: parse every
// `client.request(DOC, {...})` and `fetchAllItems(client, DOC, field, {...})`
// call with the TypeScript AST, and cross-check its keys against the
// operation's declared variables.
//
// Deliberately conservative — a call whose document or variables argument is
// not statically readable (a variable holding the object, a spread, a computed
// key) is counted as SKIPPED and reported, never silently treated as passing.

import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import ts from 'typescript';
import { parse } from 'graphql';

/** `limit`/`offset` are injected by fetchAllItems itself, not by the caller. */
const PAGER_INJECTED = ['limit', 'offset'];

/**
 * Map each document const to the variables its operation declares.
 * Returns { NAME: { required: Set, all: Set } }.
 */
export function declaredVariables(documents, resolve) {
  const out = new Map();
  for (const doc of documents) {
    let ast;
    try {
      ast = parse(resolve(doc));
    } catch {
      continue; // an invalid document is validate-graphql.mjs's problem, not ours
    }
    const op = ast.definitions.find((d) => d.kind === 'OperationDefinition');
    if (!op) continue; // fragment-only const
    const all = new Set();
    const required = new Set();
    for (const v of op.variableDefinitions ?? []) {
      const name = v.variable.name.value;
      all.add(name);
      // Required = non-null and no default. Anything else the caller may omit.
      if (v.type.kind === 'NonNullType' && v.defaultValue === undefined) required.add(name);
    }
    out.set(doc.name, { all, required, opName: op.name?.value ?? '(anon)' });
  }
  return out;
}

/**
 * Read an object literal's keys.
 *
 * `exact` is false when a spread or computed key means there may be MORE keys
 * than we can see (`{ a, ...(cond ? { b } : {}) }`). The keys we did read are
 * still trustworthy, so an unknown-key check stays valid; only the
 * missing-required check has to be suppressed.
 */
function readObject(node) {
  const keys = new Set();
  let exact = true;
  for (const prop of node.properties) {
    if (ts.isShorthandPropertyAssignment(prop)) {
      keys.add(prop.name.text);
    } else if (ts.isPropertyAssignment(prop)) {
      const n = prop.name;
      if (ts.isIdentifier(n) || ts.isStringLiteral(n)) keys.add(n.text);
      else exact = false; // computed key
    } else {
      exact = false; // spread, method, getter
    }
  }
  return { keys, exact };
}

/**
 * Objects held in a local `const vars = {…}` and then mutated (`vars.x = …`)
 * before being passed — a shape the portal uses for conditionally-sent
 * variables. A name declared more than once in the file is ambiguous (we do no
 * scope analysis), so it is dropped rather than risk a false report.
 */
function collectLocalObjects(source) {
  const objects = new Map();
  const ambiguous = new Set();

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const name = node.name.text;
      if (objects.has(name)) ambiguous.add(name);
      objects.set(name, readObject(node.initializer));
    }

    // `vars.key = …` and `vars['key'] = …` widen the known key set.
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = node.left;
      if (ts.isPropertyAccessExpression(lhs) && ts.isIdentifier(lhs.expression)) {
        objects.get(lhs.expression.text)?.keys.add(lhs.name.text);
      } else if (
        ts.isElementAccessExpression(lhs) &&
        ts.isIdentifier(lhs.expression) &&
        lhs.argumentExpression &&
        ts.isStringLiteral(lhs.argumentExpression)
      ) {
        objects.get(lhs.expression.text)?.keys.add(lhs.argumentExpression.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const name of ambiguous) objects.delete(name);
  return objects;
}

/** Resolve a call's variables argument to { keys, exact }, or null if opaque. */
function readVariablesArg(node, locals) {
  if (node === undefined) return { keys: new Set(), exact: true }; // no variables passed
  if (ts.isObjectLiteralExpression(node)) return readObject(node);
  if (ts.isIdentifier(node)) return locals.get(node.text) ?? null;
  return null;
}

/**
 * Every GraphQL call site in one file.
 * Yields { docName, keys, injected, line } — keys null when not statically readable.
 */
function callSites(source) {
  const locals = collectLocalObjects(source);
  const found = [];
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      let docArg = null;
      let varsArg = null;
      let injected = [];

      // <anything>.request(DOC, vars?)
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'request'
      ) {
        docArg = node.arguments[0];
        varsArg = node.arguments[1];
      }
      // fetchAllItems(client, DOC, field, vars?)
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'fetchAllItems') {
        docArg = node.arguments[1];
        varsArg = node.arguments[3];
        injected = PAGER_INJECTED;
      }

      if (docArg && ts.isIdentifier(docArg)) {
        found.push({
          docName: docArg.text,
          vars: readVariablesArg(varsArg, locals),
          injected,
          line: source.getLineAndCharacterOfPosition(docArg.getStart(source)).line + 1,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * Cross-check every call site against the declared variables.
 * Returns { failures, checked, skipped }.
 */
export function findCallerMismatches(files, declared, root) {
  const failures = [];
  let checked = 0;
  const skipped = [];

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('.request(') && !text.includes('fetchAllItems(')) continue;
    const rel = relative(root, file);
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);

    for (const site of callSites(source)) {
      const spec = declared.get(site.docName);
      if (!spec) continue; // not one of our documents (or fragment-only)

      if (site.vars === null) {
        skipped.push(`${rel}:${site.line}  ${site.docName} (variables not statically readable)`);
        continue;
      }
      checked += 1;

      const passed = new Set([...site.vars.keys, ...site.injected]);
      const unknown = [...site.vars.keys].filter((k) => !spec.all.has(k));
      // Only when we can see every key — a spread may supply the rest.
      const missing = site.vars.exact ? [...spec.required].filter((r) => !passed.has(r)) : [];
      if (unknown.length === 0 && missing.length === 0) continue;

      const errors = [];
      for (const k of unknown) {
        const hint = [...spec.all].filter((d) => !passed.has(d));
        errors.push(
          `passes "${k}", which ${spec.opName} does not declare` +
            (hint.length ? ` — did you mean ${hint.map((h) => `"${h}"`).join(' or ')}?` : ''),
        );
      }
      for (const m of missing) {
        errors.push(`omits required variable "$${m}" of ${spec.opName}`);
      }
      failures.push({ file: rel, line: site.line, name: site.docName, errors });
    }
  }

  return { failures, checked, skipped };
}
