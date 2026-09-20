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
 * #868 — the helper that picks a node-update mutation at runtime, and the
 * operation its result is checked against. Resolved through `isChooserCall`
 * and `chooserLocals` below, which cover the aliased and hoisted spellings.
 */
const DOCUMENT_CHOOSER = 'nodeUpdateDocument';
const CHOOSER_REPRESENTATIVE = 'UPDATE_NODE_MUTATION';

/**
 * The local names `nodeUpdateDocument` is bound to in this file — it may be
 * imported under an alias, which routes perfectly well but would leave this
 * gate skipping the call's variables (@copilot on PR #869).
 */
function chooserBindings(source) {
  const names = new Set([DOCUMENT_CHOOSER]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === DOCUMENT_CHOOSER) {
        names.add(element.name.text);
      }
    }
  }
  return names;
}

/** A call to the chooser, under any local name or through a namespace. */
function isChooserCall(node, names) {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    (ts.isIdentifier(callee) && names.has(callee.text)) ||
    (ts.isPropertyAccessExpression(callee) && callee.name.text === DOCUMENT_CHOOSER)
  );
}

/**
 * Locals holding a chooser result — `const mutation = nodeUpdateDocument(…)`.
 *
 * Passing that local to `.request()` counts as routed for the door gate while
 * reading as an unknown document here, so the call's variables were silently
 * skipped (@copilot). Measured on this PR in the other direction: hoisting the
 * chooser into a local dropped the checked call-site count 290 → 288.
 */
function chooserLocals(source, names) {
  const locals = new Set();
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isChooserCall(node.initializer, names)
    ) {
      locals.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return locals;
}

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

/** Is this node inside a branch/loop, i.e. might it not execute? */
function isConditional(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (
      ts.isIfStatement(p) ||
      ts.isConditionalExpression(p) ||
      ts.isSwitchStatement(p) ||
      ts.isForStatement(p) ||
      ts.isForOfStatement(p) ||
      ts.isForInStatement(p) ||
      ts.isWhileStatement(p) ||
      ts.isDoStatement(p) ||
      ts.isCatchClause(p) ||
      (ts.isBinaryExpression(p) &&
        (p.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
          p.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          p.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken))
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Objects held in a local `const vars = {…}` and then mutated (`vars.x = …`) —
 * a shape the portal uses for conditionally-sent variables.
 *
 * Assignments are recorded with their POSITION and whether they sit in a
 * branch, because a whole-file union would accept
 * `const v = {}; request(DOC, v); v.ref = x` as supplying `ref` when the
 * request already went out without it (#690 review). A call site resolves only
 * the assignments that precede it, and an assignment inside a branch widens the
 * key set for the stale-key check without ever satisfying a required variable.
 *
 * A name declared more than once in the file is ambiguous (we do no scope
 * analysis), so it is dropped rather than risk a false report.
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
      objects.set(name, { base: readObject(node.initializer), assignments: [] });
    }

    // `vars.key = …` and `vars['key'] = …` widen the known key set.
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = node.left;
      let owner = null;
      let key = null;
      if (ts.isPropertyAccessExpression(lhs) && ts.isIdentifier(lhs.expression)) {
        owner = lhs.expression.text;
        key = lhs.name.text;
      } else if (
        ts.isElementAccessExpression(lhs) &&
        ts.isIdentifier(lhs.expression) &&
        lhs.argumentExpression &&
        ts.isStringLiteral(lhs.argumentExpression)
      ) {
        owner = lhs.expression.text;
        key = lhs.argumentExpression.text;
      }
      if (owner && objects.has(owner)) {
        objects.get(owner).assignments.push({
          key,
          pos: node.getStart(source),
          conditional: isConditional(node),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  for (const name of ambiguous) objects.delete(name);
  return objects;
}

/** The object's shape as of `pos` — see collectLocalObjects. */
function shapeAt(entry, pos) {
  const keys = new Set(entry.base.keys);
  let exact = entry.base.exact;
  for (const a of entry.assignments) {
    if (a.pos >= pos) continue; // happens after the call — cannot have applied
    keys.add(a.key);
    // A branch may not have run, so we can no longer claim to see every key.
    if (a.conditional) exact = false;
  }
  return { keys, exact };
}

/**
 * Does this argument look like a GraphQL operation written inline?
 * A string/template literal naming an operation type is one; anything else
 * (a helper call, a member access) is left to the opaque path.
 */
function isInlineDocument(node) {
  const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
    ? node.text
    : ts.isTemplateExpression(node)
      ? node.head.text
      : null;
  return text !== null && /\b(query|mutation|subscription|fragment)\b/.test(text);
}

/**
 * Resolve a call's variables argument to { keys, exact }, or null if opaque.
 * `callPos` bounds which local-object assignments can have applied yet.
 */
function readVariablesArg(node, locals, callPos) {
  if (node === undefined) return { keys: new Set(), exact: true }; // no variables passed
  if (ts.isObjectLiteralExpression(node)) return readObject(node);
  if (ts.isIdentifier(node)) {
    const entry = locals.get(node.text);
    return entry ? shapeAt(entry, callPos) : null;
  }
  return null;
}

/**
 * Every GraphQL call site in one file.
 * Yields { docName, keys, injected, line } — keys null when not statically readable.
 */
function callSites(source) {
  const locals = collectLocalObjects(source);
  const chooserNames = chooserBindings(source);
  const chooserHeld = chooserLocals(source, chooserNames);
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

      if (docArg) {
        const line = source.getLineAndCharacterOfPosition(docArg.getStart(source)).line + 1;
        const viaChooser =
          isChooserCall(docArg, chooserNames) ||
          (ts.isIdentifier(docArg) && chooserHeld.has(docArg.text));
        if (viaChooser) {
          // #868: `client.request(nodeUpdateDocument(node, input), { input })`.
          // The document is chosen at RUNTIME from the node's governed kind, so
          // there is no identifier here to look up — and without this branch
          // every routed node write would fall through to the opaque path and
          // stop being variable-checked. Every routed node write going quietly
          // unchecked is worse than the rename this gate was built to catch —
          // measured while writing this: the checked count drops from 290 to
          // 280 with this branch removed.
          //
          // Resolving to one representative operation is sound only because the
          // four doors declare identical variables, which is NOT assumed here:
          // `doorVariablesAgree` in check-node-write-doors.mjs asserts it, and
          // reds this gate's own run if a door ever diverges.
          found.push({
            docName: CHOOSER_REPRESENTATIVE,
            vars: readVariablesArg(varsArg, locals, node.getStart(source)),
            injected,
            line,
          });
        } else if (ts.isIdentifier(docArg)) {
          found.push({
            docName: docArg.text,
            vars: readVariablesArg(varsArg, locals, node.getStart(source)),
            injected,
            line,
          });
        } else if (isInlineDocument(docArg)) {
          // An operation written inline never reaches the `/* GraphQL */`
          // extractor, so it is validated by NOTHING — not the schema check,
          // not the naming rule, not this one. Two such documents sat in the
          // portal with the pre-sweep `ref: $id` spelling while the gate
          // reported success (#690 review). Report, never skip silently.
          found.push({ inline: true, line });
        }
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
    // Match `.request(` AND `.request<T>(` — the portal's endpoints and loaders
    // overwhelmingly annotate the response type inline
    // (`client.request<{ memory: Memory }>(DOC, vars)`), and a literal
    // `.includes('.request(')` skipped every one of those files WHOLESALE: 46
    // files, never parsed, while the gate reported a healthy call-site count.
    // That is how the `completeAssetUpload` caller shipped passing `{ uploadId }`
    // against `$input: CompleteAssetUploadInput!` and stayed broken from #182
    // (portal#696). A pre-filter that silently drops files is worse than none.
    if (!/\.request\s*[<(]/.test(text) && !text.includes('fetchAllItems(')) continue;
    const rel = relative(root, file);
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);

    for (const site of callSites(source)) {
      if (site.inline) {
        failures.push({
          file: rel,
          line: site.line,
          name: '(inline document)',
          errors: [
            'a GraphQL operation written inline is validated by nothing — ' +
              'move it to a `const NAME = /* GraphQL */ `…`` so the gate can see it',
          ],
        });
        continue;
      }
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
