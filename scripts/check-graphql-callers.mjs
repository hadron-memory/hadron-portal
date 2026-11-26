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
import { parse, typeFromAST, getNamedType, isInputObjectType, isListType, isNonNullType } from 'graphql';

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

  // `const { nodeUpdateDocument: choose } = door` — a destructured namespace
  // binding, which is neither an import specifier nor a property access at the
  // call site (@copilot). Walked rather than read off the statements, since it
  // can sit anywhere.
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        const source_ = element.propertyName ?? element.name;
        if (ts.isIdentifier(source_) && source_.text === DOCUMENT_CHOOSER && ts.isIdentifier(element.name)) {
          names.add(element.name.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

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
    // #2609: the declared type of each variable, so an input-object variable's KEYS can be checked too.
    const types = new Map();
    for (const v of op.variableDefinitions ?? []) {
      const name = v.variable.name.value;
      all.add(name);
      types.set(name, v.type);
      // Required = non-null and no default. Anything else the caller may omit.
      if (v.type.kind === 'NonNullType' && v.defaultValue === undefined) required.add(name);
    }
    out.set(doc.name, { all, required, types, opName: op.name?.value ?? '(anon)' });
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
export function callSites(source) {
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
            varsNode: varsArg,
            pos: node.getStart(source),
            injected,
            line,
          });
        } else if (ts.isIdentifier(docArg)) {
          found.push({
            docName: docArg.text,
            vars: readVariablesArg(varsArg, locals, node.getStart(source)),
            varsNode: varsArg,
            pos: node.getStart(source),
            injected,
            line,
          });
        } else if (ts.isCallExpression(docArg)) {
          // A call in the document position that did NOT resolve to the
          // chooser — a wrapper, a factory, anything (@copilot on PR #869).
          //
          // Reported as SKIPPED rather than resolved. Chasing a wrapper's
          // return value transitively is dataflow analysis, and a gate that
          // does it badly is worse than one that says it does not: it would
          // report a confident result on a document it guessed at. This module
          // already promises in its own header that an unreadable call is
          // "counted as SKIPPED and reported, never silently treated as
          // passing" — the variables argument delivered that and the DOCUMENT
          // argument did not, which is the actual defect here.
          found.push({ unresolved: true, line, text: docArg.getText(source).slice(0, 60) });
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
      if (site.unresolved) {
        skipped.push(
          `${rel}:${site.line}  ${site.text} (document expression not statically ` +
            'resolvable — if it wraps nodeUpdateDocument, call it inline so the ' +
            "call's variables stay checked)",
        );
        continue;
      }
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


// ---------------------------------------------------------------------------
// #2609 — the keys INSIDE an input-object variable.
//
// findCallerMismatches checks the TOP-LEVEL keys of the variables a caller
// passes. A node write passes `{ input }`, and the keys of `input` (`memoryId`,
// `id`, `edges[].targetId`) were checked by nothing: the node-update input type
// has an index signature and most inputs are `Record<string, unknown>`, so tsc
// sees nothing either. hadron-server#5080 renamed 21 such fields to `*Ref`; the
// portal would have shipped every node save broken, silently, until runtime.
//
// For each call site whose variables are statically readable, an input-typed
// variable's value is read — an object literal, a `const input = {…}` visible
// from the call (resolved by scope, so one `input` per action does not read as
// one ambiguous name), `input.x = …` assignments before the call, nested
// objects, and `list.map((e) => ({…}))` — and its keys are checked against that
// input type in the schema snapshot. What cannot be read is reported as skipped
// and never passes silently.
// ---------------------------------------------------------------------------

/** Parentheses, `as`, `satisfies` and `!` do not change which object a value is. */
function unwrapExpr(node) {
  let n = node;
  while (
    n &&
    (ts.isParenthesizedExpression(n) ||
      ts.isAsExpression(n) ||
      ts.isSatisfiesExpression(n) ||
      ts.isNonNullExpression(n))
  ) {
    n = n.expression;
  }
  return n;
}

const SCOPE_KINDS = new Set([
  ts.SyntaxKind.Block,
  ts.SyntaxKind.SourceFile,
  ts.SyntaxKind.ModuleBlock,
  ts.SyntaxKind.CaseClause,
  ts.SyntaxKind.DefaultClause,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.CatchClause,
]);

function scopeOf(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (SCOPE_KINDS.has(p.kind) || ts.isFunctionLike(p)) return p;
  }
  return null;
}

/**
 * Every name a file binds, with where it is visible, so a use resolves to the
 * NEAREST binding. `literal` is the object literal it was initialised with, or
 * null for a parameter, a destructured binding, a loop variable or any other
 * initialiser. A nearest binding with no literal means "not readable" — it must
 * never fall through to an outer binding of the same name.
 */
function collectBindings(source) {
  const bindings = [];
  const add = (name, node, literal) => {
    bindings.push({ name, scope: scopeOf(node), pos: node.getStart(source), literal, assignments: [] });
  };
  const bindName = (nameNode, literal) => {
    if (ts.isIdentifier(nameNode)) add(nameNode.text, nameNode, literal);
    else if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
      for (const el of nameNode.elements) if (ts.isBindingElement(el)) bindName(el.name, null);
    }
  };
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) {
      const init = node.initializer ? unwrapExpr(node.initializer) : undefined;
      bindName(node.name, init && ts.isObjectLiteralExpression(init) ? init : null);
    } else if (ts.isParameter(node)) {
      bindName(node.name, null);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return bindings;
}

function contains(scope, node) {
  for (let p = node; p; p = p.parent) if (p === scope) return true;
  return false;
}

/** The nearest binding of `name` visible at `node`, or null. */
function resolveBinding(bindings, name, node) {
  const use = node.getStart();
  let best = null;
  for (const b of bindings) {
    if (b.name !== name || b.pos > use || !(b.scope && contains(b.scope, node))) continue;
    if (!best || contains(best.scope, b.scope.parent ?? b.scope) || (b.scope === best.scope && b.pos > best.pos)) best = b;
  }
  return best;
}

function attachAssignments(source, bindings) {
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = node.left;
      let owner = null;
      let key = null;
      if (ts.isPropertyAccessExpression(lhs) && ts.isIdentifier(lhs.expression)) {
        owner = lhs.expression;
        key = lhs.name.text;
      } else if (
        ts.isElementAccessExpression(lhs) &&
        ts.isIdentifier(lhs.expression) &&
        lhs.argumentExpression &&
        ts.isStringLiteral(lhs.argumentExpression)
      ) {
        owner = lhs.expression;
        key = lhs.argumentExpression.text;
      }
      if (owner) {
        const b = resolveBinding(bindings, owner.text, node);
        if (b && b.literal) b.assignments.push({ key, value: node.right, pos: node.getStart(source) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** A readable object: the literal, plus the `x.key = value` assignments that precede `pos`. */
function readableObject(expr, bindings, pos) {
  const e = unwrapExpr(expr);
  if (!e) return null;
  if (ts.isObjectLiteralExpression(e)) return { literal: e, assignments: [] };
  if (ts.isIdentifier(e)) {
    const b = resolveBinding(bindings, e.text, e);
    return b && b.literal ? { literal: b.literal, assignments: b.assignments.filter((a) => a.pos < pos) } : null;
  }
  return null;
}

/** The members of `list.map((e) => ({…}))`, as one readable object per returned literal; null otherwise. */
function mappedLiterals(expr) {
  const e = unwrapExpr(expr);
  if (!e || !ts.isCallExpression(e) || !ts.isPropertyAccessExpression(e.expression) || e.expression.name.text !== 'map') {
    return null;
  }
  const fn = e.arguments[0];
  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return null;
  const body = fn.body;
  if (!ts.isBlock(body)) {
    const v = unwrapExpr(body);
    return v && ts.isObjectLiteralExpression(v) ? [v] : null;
  }
  const returns = [];
  const visit = (n) => {
    if (n !== body && ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) returns.push(unwrapExpr(n.expression));
    ts.forEachChild(n, visit);
  };
  visit(body);
  return returns.length > 0 && returns.every((r) => r && ts.isObjectLiteralExpression(r)) ? returns : null;
}

/** Key name, value expression and whether the object may hold keys we cannot see. */
function membersOf(readable, bindings) {
  const members = [];
  let exact = true;
  const fromLiteral = (literal) => {
    for (const prop of literal.properties) {
      if (ts.isShorthandPropertyAssignment(prop)) members.push({ key: prop.name.text, value: prop.name });
      else if (ts.isPropertyAssignment(prop)) {
        const n = prop.name;
        if (ts.isIdentifier(n) || ts.isStringLiteral(n)) members.push({ key: n.text, value: prop.initializer });
        else exact = false;
      } else if (ts.isSpreadAssignment(prop)) {
        // `...(cond ? { role } : {})` — read the literals of both branches; anything else is unseen.
        const sp = unwrapExpr(prop.expression);
        const branches = sp && ts.isConditionalExpression(sp) ? [sp.whenTrue, sp.whenFalse] : [sp];
        for (const b of branches) {
          const lit = b && unwrapExpr(b);
          if (lit && ts.isObjectLiteralExpression(lit)) fromLiteral(lit);
          else exact = false;
        }
      } else exact = false;
    }
  };
  fromLiteral(readable.literal);
  for (const a of readable.assignments) members.push({ key: a.key, value: a.value });
  return { members, exact };
}

const STEM = /(Refs|Ref|Ids|Id)$/;
const stem = (k) => (k === 'id' || k === 'ref' ? 'ref' : k.replace(STEM, ''));

/**
 * Check one value against an input type. Pushes errors/skips into `acc`.
 * `type` is a GraphQLType (not an AST node).
 */
function checkValue(expr, type, ctx, path) {
  const named = getNamedType(type);
  if (!isInputObjectType(named)) return;
  const e = unwrapExpr(expr);
  if (!e) return;
  if (e.kind === ts.SyntaxKind.NullKeyword || (ts.isIdentifier(e) && e.text === 'undefined')) return;

  let t = type;
  if (isNonNullType(t)) t = t.ofType;
  if (isListType(t)) {
    const item = t.ofType;
    if (ts.isArrayLiteralExpression(e)) {
      e.elements.forEach((el, i) => checkValue(el, item, ctx, `${path}[${i}]`));
      return;
    }
    const mapped = mappedLiterals(e);
    if (mapped) {
      for (const lit of mapped) checkValue(lit, item, ctx, `${path}[]`);
      return;
    }
    ctx.skipped.push(`${ctx.rel}:${ctx.line}  ${ctx.doc} ${path} (list of ${named.name} not statically readable)`);
    return;
  }

  const readable = readableObject(e, ctx.bindings, ctx.pos);
  if (!readable) {
    ctx.skipped.push(`${ctx.rel}:${ctx.line}  ${ctx.doc} ${path} (${named.name} not statically readable)`);
    return;
  }
  ctx.checked += 1;
  const fields = named.getFields();
  const { members, exact } = membersOf(readable, ctx.bindings);
  if (!exact) {
    ctx.skipped.push(`${ctx.rel}:${ctx.line}  ${ctx.doc} ${path} (${named.name} has keys the gate cannot read; the readable ones were checked)`);
  }
  const passed = new Set(members.map((m) => m.key));
  for (const m of members) {
    const field = fields[m.key];
    if (!field) {
      const hint = Object.keys(fields).filter((f) => !passed.has(f) && stem(f) === stem(m.key));
      ctx.errors.push(
        `${path} passes "${m.key}", which ${named.name} does not declare` +
          (hint.length ? ` — did you mean ${hint.map((h) => `"${h}"`).join(' or ')}?` : ''),
      );
      continue;
    }
    checkValue(m.value, field.type, ctx, `${path}.${m.key}`);
  }
}

/**
 * Cross-check the keys of every statically readable input-object variable.
 * Returns { failures, checked, skipped } like findCallerMismatches; `checked`
 * counts the input objects whose keys were read.
 */
export function findInputKeyMismatches(files, declared, schema, root) {
  const failures = [];
  const skipped = [];
  let checked = 0;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!/\.request\s*[<(]/.test(text) && !text.includes('fetchAllItems(')) continue;
    const rel = relative(root, file);
    const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
    const bindings = collectBindings(source);
    attachAssignments(source, bindings);

    for (const site of callSites(source)) {
      if (site.unresolved || site.inline || !site.varsNode) continue;
      const spec = declared.get(site.docName);
      if (!spec || !spec.types) continue;
      const inputVars = [...spec.types].filter(([, node]) => isInputObjectType(getNamedType(typeFromAST(schema, node) ?? schema.getType('String'))));
      if (inputVars.length === 0) continue;

      const vars = readableObject(site.varsNode, bindings, site.pos);
      if (!vars) {
        skipped.push(`${rel}:${site.line}  ${site.docName} (input variables not statically readable)`);
        continue;
      }
      const { members } = membersOf(vars, bindings);
      for (const [name, typeNode] of inputVars) {
        const type = typeFromAST(schema, typeNode);
        if (!type) continue;
        // The last write to a key wins; every conditional alternative is a candidate.
        const values = members.filter((m) => m.key === name);
        if (values.length === 0) continue;
        const ctx = { rel, line: site.line, doc: site.docName, bindings, pos: site.pos, errors: [], skipped, checked: 0 };
        for (const v of values) checkValue(v.value, type, ctx, `$${name}`);
        checked += ctx.checked;
        if (ctx.errors.length > 0) failures.push({ file: rel, line: site.line, name: site.docName, errors: ctx.errors });
      }
    }
  }
  return { failures, checked, skipped };
}
