// The node-write DOOR gate (#868).
//
// `src/lib/server/nodeKindDoor.ts` picks the mutation a node update goes
// through. A helper makes the right thing easy; it does not make the wrong
// thing impossible, and "remember to call the chooser" written in a comment is
// enforced by whoever happens to read that file
// (hrn:node:hadronmemory.com:hadron-portal:review:comment-cannot-enforce-a-per-instance-rule).
// Ten call sites each remembering to route is the shape that produced #868 in
// the first place.
//
// So this gate inverts the default: REACHING a node-update mutation at all —
// by naming its document, or by declaring your own — FAILS unless the file is
// in ALLOWED below, with a reason. An eleventh call site added next year has to
// opt out, visibly, in a file a reviewer reads, rather than opt in silently and
// be refused in production against the first governed node it meets.
//
// It took four rounds to arrive at "reaching", and every round was the same
// mistake — asking what a thing is NAMED rather than what it DOES. In order:
// the bare identifier at the call site, a local variable holding it, an aliased
// or namespaced import, and a document the caller declared itself. Two were
// found by probing this gate with the shape it exists to catch; two by review
// bots on PR #869, one of them an hour after a commit message here claimed the
// hole could not exist. See
// hrn:node:hadronmemory.com:hadron-portal:review:gate-the-import-not-the-call-site
//
// Two things it deliberately also checks, because a gate that can only report
// "nothing wrong" is indistinguishable from a gate that is not looking:
//
//   1. It counts the ROUTED call sites and fails below a floor. Without that,
//      deleting the chooser and every call it serves would leave this gate
//      green — the exact false green #862 is open about elsewhere in this repo.
//   2. It asserts every door document declares the SAME variables. That is what
//      makes `check-graphql-callers.mjs`'s resolution of `nodeUpdateDocument()`
//      to one representative operation sound rather than assumed.

import { readFileSync } from 'node:fs';
import { relative, sep } from 'node:path';
import ts from 'typescript';
import { parse } from 'graphql';

/** The mutation documents that write a node. Every one must go through the chooser. */
export const DOOR_DOCUMENTS = [
  'UPDATE_NODE_MUTATION',
  'UPDATE_TASK_NODE_MUTATION',
  'UPDATE_REVIEW_NODE_MUTATION',
  'UPDATE_SPEC_NODE_MUTATION',
];

/**
 * The GraphQL OPERATIONS those documents call. Checked separately, because a
 * caller does not have to go anywhere near `DOOR_DOCUMENTS` to write a node —
 * it can declare its own document inline:
 *
 *   const UPDATE = `mutation U($input: UpdateNodeInput!) { updateNode(input: $input) { id } }`;
 *
 * That is not hypothetical either: `app/agents/[id]/conversations/+page.server.ts`
 * has done exactly this for seven writes, and the first version of this gate
 * declared the repository clean while they sat on the generic door (@codex on
 * PR #869). It has no `/* GraphQL *\/` marker, so `validate-graphql` does not
 * extract it and `check-graphql-callers` cannot resolve it either — it is
 * invisible to every other check in this file's family.
 *
 * Gating the CONSTANT was the same mistake as gating the CALL SITE, one level
 * out: both ask what something is named rather than what it does.
 */
export const DOOR_OPERATIONS = [
  'updateNode',
  'updateTaskNode',
  'updateReviewNode',
  'updateSpecNode',
];

/** The chooser itself — the one place allowed to hold the documents. */
export const DOOR_MODULE = 'src/lib/server/nodeKindDoor.ts';

/** The helper every node write must go through. */
export const CHOOSER = 'nodeUpdateDocument';

/**
 * Where the documents are DEFINED. Every door operation written here must
 * belong to one of the four `DOOR_DOCUMENTS` consts — a fifth node-write
 * document added to the registry under some other name would otherwise be
 * importable without tripping the import check, since that check knows only
 * these four names.
 */
export const DOCUMENT_REGISTRY = 'src/lib/server/queries.ts';

/**
 * EXACT call sites exempted, each with the reason it is not routed.
 *
 * An exact list, never a pattern: a pattern is a hiding place, because the next
 * file that happens to match inherits an exemption nobody granted it
 * (hrn:node:hadronmemory.com:hadron-cli:review:an-exemption-you-cannot-enumerate-is-a-hiding-place).
 * Keyed by file, so moving a call within a file does not silently re-grant it —
 * the file is the unit a reviewer actually reads.
 */
export const ALLOWED = new Map([
  [
    'src/routes/api/agent-chat/fixtures/+server.ts',
    'The agent-tester fixture record. The portal MINTS these itself through ' +
      'createNode (which refuses a governed kind outright) at a loc the handler ' +
      'gates on the "fixtures:" prefix, and no portal path ever writes role or ' +
      'isRunnable on one — so the resulting kind is always ungoverned. Routing ' +
      'it would cost a node fetch per write to learn a constant. Residual, ' +
      'accepted: a fixture node governed by some OTHER tool would make this ' +
      'endpoint fail loudly rather than corrupt anything.',
  ],
  [
    'src/routes/app/agents/[id]/conversations/+page.server.ts',
    'TRACKED, NOT ARGUED AWAY — portal#870. Seven writes through a locally ' +
      'declared updateNode document, found by @codex on PR #869 when the gate ' +
      'still keyed on the four constant names. Four of the seven already fetch ' +
      'the node and route almost for free; the other two are the update-first, ' +
      'create-on-miss flow that exists BECAUSE a stage promptRef can dangle, so ' +
      'pre-fetching to learn the kind changes its race semantics. Routing four ' +
      'of seven leaves the file half-fixed, and this is the chatbot wizard — a ' +
      'surface #869 did not drive. Reachable today only by pointing "Convert to ' +
      'task" at a conversation, stage or prompt node. Remove this entry with ' +
      'the fix; the stale-exemption check makes that impossible to forget.',
  ],
  [
    'src/routes/api/agent-chat/fixtures/run/+server.ts',
    'persistNewBaseline, writing back the same fixture record the handler above ' +
      'minted. Same reasoning, same residual — and the runner holds a parsed ' +
      'FixtureRecord rather than a MemoryNode, so it has no governance signals ' +
      'to route on without a fetch per fixture in a sequential batch loop.',
  ],
]);

/**
 * The floor. Below this many routed call sites the gate is not measuring the
 * thing it claims to: a repo where the chooser has been ripped out would
 * otherwise pass with flying colours, having found no violations because there
 * is nothing left to violate.
 *
 * Deliberately a FLOOR, not an exact count — adding a routed call site is the
 * behaviour this gate wants and must not need a number edited to permit it.
 */
export const MIN_ROUTED_CALL_SITES = 10;

/** Files the gate must at least have looked at, so an empty scan cannot pass. */
export const MIN_FILES_SCANNED = 1;

/** Both test lanes — `*.test.ts` (node) and `*.client.test.ts` (jsdom). */
export function isTestFile(rel) {
  return /\.(client\.)?test\.[cm]?[jt]sx?$/.test(rel);
}

/**
 * Every REFERENCE to a door document in one file, by any spelling.
 *
 * ## Why this is a walk and not a list of forms
 *
 * Five rounds of review on PR #869 produced five ways to reach a door document
 * without matching the check in front of it: the bare identifier at the call
 * site, a local variable holding it, an aliased import, a namespace property,
 * and — @copilot's fifth round — element access, a destructured namespace
 * binding, and a barrel re-export. Each fix was a new form added to a list, and
 * each time the list was one form short. An enumerated list of spellings is a
 * losing shape, and a comment here claiming the list was complete was wrong
 * three separate times.
 *
 * So the rule is closed instead: **any Identifier or StringLiteral in the file
 * whose text is a door document name is a reference.** That covers every form
 * above and every form nobody has thought of, because a file cannot reach one
 * of these documents without writing its name somewhere the parser can see.
 *
 * Comments are not AST nodes, so prose about the rule is not a violation — the
 * check would otherwise teach people to stop explaining it (hadron-server's
 * `no-agent-specific-code` failed a docs-only PR for exactly that). Verified
 * against the tree before adopting it: one file mentions a door name in a
 * comment and nowhere else, and it is correctly silent.
 *
 * The cost is bluntness. A file that merely NAMES a door document, without
 * calling anything, is now reported — and that is the trade taken on purpose:
 * a loud false positive is answered by the exemption list in one line, and a
 * silent false negative is what #868 was.
 */
function doorReferences(source) {
  const found = [];
  const visit = (node) => {
    if (
      (ts.isIdentifier(node) || ts.isStringLiteral(node)) &&
      DOOR_DOCUMENTS.includes(node.text)
    ) {
      found.push({
        name: node.text,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * The local names `nodeUpdateDocument` is bound to in this file.
 *
 * An aliased import (`import { nodeUpdateDocument as choose }`) routes
 * perfectly well but would not be COUNTED as routed, which erodes the floor
 * silently and makes `check-graphql-callers` skip the call's variables
 * (@copilot). The bare name is always included so a file that never imports it
 * — a test fixture string, say — still reads naturally.
 */
function chooserBindings(source) {
  const names = new Set([CHOOSER]);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if ((element.propertyName ?? element.name).text === CHOOSER) names.add(element.name.text);
    }
  }
  return names;
}

/** Does this literal's text call one of the door operations? */
function namesDoorOperation(text) {
  return DOOR_OPERATIONS.some((op) => new RegExp(`\\b${op}\\s*\\(`).test(text));
}

/**
 * Every GraphQL document written INLINE in this file that calls a door
 * operation, with the `const` name it was bound to (null when it is not bound
 * to one).
 *
 * Matched on the AST's string and template literals, never on the raw file
 * text: a comment explaining "this used to call updateNode()" is prose, and a
 * gate that cannot tell prose from code teaches people to stop writing the
 * prose (`no-agent-specific-check-hits-comments` in hadron-server, same shape).
 */
function inlineDoorDocuments(source) {
  const found = [];
  const visit = (node) => {
    const text = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
      ? node.text
      : ts.isTemplateExpression(node)
        ? node.head.text + node.templateSpans.map((s) => s.literal.text).join('')
        : null;
    if (text !== null && namesDoorOperation(text)) {
      // The nearest enclosing `const NAME = …`, so the registry check can ask
      // which binding a door document landed on.
      let binding = null;
      for (let p = node.parent; p; p = p.parent) {
        if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) {
          binding = p.name.text;
          break;
        }
      }
      found.push({
        binding,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      });
      return; // no need to descend into a literal
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * How many ROUTED node writes this file performs — calls to the chooser, under
 * whatever local name it was imported as, or through a namespace.
 *
 * There is deliberately no matching "direct `.request(DOC, …)`" collection any
 * more. `doorReferences` sees the identifier in the document position as one of
 * its own hits, so a separate call-site check only produced a second line of
 * red for the same mistake — and a version of it carried a comment claiming it
 * additionally caught barrel re-exports, which it never did (@copilot).
 */
function routedWrites(source) {
  const chooserNames = chooserBindings(source);
  let routed = 0;
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (
        (ts.isIdentifier(callee) && chooserNames.has(callee.text)) ||
        (ts.isPropertyAccessExpression(callee) && callee.name.text === CHOOSER)
      ) {
        routed += 1;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return routed;
}

/**
 * Check every door document declares the same variables.
 *
 * `nodeUpdateDocument` returns one of four documents chosen at runtime, so
 * check-graphql-callers cannot read the document at a routed call site and
 * resolves it to ONE representative operation instead. That resolution is only
 * sound while the four agree — and they agree today because the server made the
 * doors "identical to updateNode otherwise". If one ever takes a second
 * variable, the caller gate would go quietly wrong on every routed call site.
 * This is the assertion that makes the shortcut safe rather than lucky.
 */
/** A GraphQL type node as source text — `[Foo!]!` and so on. */
function printTypeNode(type) {
  if (type.kind === 'NonNullType') return `${printTypeNode(type.type)}!`;
  if (type.kind === 'ListType') return `[${printTypeNode(type.type)}]`;
  return type.name.value;
}

export function doorVariablesAgree(resolve) {
  const signatures = new Map();
  for (const name of DOOR_DOCUMENTS) {
    // A document that cannot be READ is validate-graphql's own finding,
    // reported with a file and a line. Anything thrown here aborts the WHOLE
    // run — no findings, no summary, no `--json` — which is the failure this
    // check exists beside, not one it should cause.
    //
    // RESOLUTION is inside the guard as well as parsing, and that boundary was
    // wrong for one round: `resolveInterpolations` throws on a circular
    // interpolation or a `${X}` naming something that is not a GraphQL
    // document, and that call sat one line above the try (@codex). Fixing the
    // parse half and leaving the resolve half was the same bug a line earlier.
    //
    // Neither is hypothetical: a stray backtick inside a `#` comment truncates
    // every document after it, which happened while writing this PR and is how
    // the first defect in it was found.
    let ast;
    try {
      const text = resolve(name);
      if (text === undefined) {
        return [`${name} is not defined in src/lib/server/queries.ts`];
      }
      ast = parse(text);
    } catch (e) {
      return [
        `${name} could not be read as a GraphQL document, so the doors cannot ` +
          `be compared (${e instanceof Error ? e.message : String(e)}) — fix ` +
          'the document; validate-graphql reports it with a file and a line.',
      ];
    }
    const op = ast.definitions.find((d) => d.kind === 'OperationDefinition');
    if (!op) return [`${name} declares no operation`];
    // NAME AND TYPE, not the name alone (@copilot on PR #869). Two doors both
    // taking `$input` agree on nothing useful if one takes UpdateNodeInput and
    // the other something else — check-graphql-callers checks the caller's KEYS
    // against one representative operation, and a differing type would make
    // that check quietly meaningless rather than loud.
    const vars = (op.variableDefinitions ?? [])
      .map((v) => `$${v.variable.name.value}: ${printTypeNode(v.type)}`)
      .sort()
      .join(', ');
    signatures.set(name, vars);
  }
  const distinct = new Set(signatures.values());
  if (distinct.size === 1) return [];
  return [
    'the node-write doors no longer declare the same variables, so ' +
      'check-graphql-callers cannot resolve a routed call site to one of them: ' +
      [...signatures].map(([n, v]) => `${n} takes (${v || 'nothing'})`).join('; '),
  ];
}

/**
 * Scan ONE file's source. Returns { failures, routed, looked } — `looked` is
 * false when the file names none of the identifiers this gate is about.
 *
 * Separated from the disk walk so the gate's own test can state a case as a
 * string rather than a fixture tree, and so each SILENCE below is a case the
 * test can name:
 * hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven
 */
export function scanSource(rel, text) {
  const exempt = ALLOWED.has(rel);

  // No pre-filter on `.request(`: skipping files by substring is how the caller
  // gate went blind to 46 of them. The only skip is "this file mentions nothing
  // this gate is about" — and that now includes the OPERATION names, not just
  // the four constants, because a file can write a node without going near
  // them (see DOOR_OPERATIONS).
  //
  // An EXEMPTED file is never skipped, whatever it contains. Its grant is the
  // thing being checked, and a file that has stopped naming a door is precisely
  // the case where the grant has gone stale — skipping it here is how the stale
  // check would have been unreachable in the one situation it exists for.
  if (
    !exempt &&
    !DOOR_DOCUMENTS.some((d) => text.includes(d)) &&
    !DOOR_OPERATIONS.some((op) => text.includes(op)) &&
    !text.includes('nodeUpdateDocument')
  ) {
    return { failures: [], routed: 0, looked: false };
  }

  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const references = doorReferences(source);
  const inline = inlineDoorDocuments(source);
  const routed = routedWrites(source);
  const failures = [];

  // The registry is where the four documents live, so an inline door operation
  // is expected there — but only under one of the four names the import check
  // knows. A fifth would be importable with the gate none the wiser.
  if (rel === DOCUMENT_REGISTRY) {
    for (const doc of inline) {
      if (doc.binding !== null && DOOR_DOCUMENTS.includes(doc.binding)) continue;
      failures.push(
        `${rel}:${doc.line}  declares a node-update document as ` +
          `${doc.binding ?? '(an unbound literal)'} — every one must be one of ` +
          `${DOOR_DOCUMENTS.join(', ')}, because that is the list the import ` +
          'check knows to guard. Add it to DOOR_DOCUMENTS in the same commit.',
      );
    }
    return { failures, routed, looked: true };
  }

  if (!exempt) {
    // A document written INLINE reaches the generic door without ever naming a
    // constant — invisible to the reference walk, and to every other GraphQL
    // gate in this repo.
    for (const doc of inline) {
      failures.push(
        `${rel}:${doc.line}  declares its own node-update document — a write ` +
          'through it goes to whichever door the document names, regardless of ' +
          "the node's kind. Use nodeUpdateDocument(node, input) from " +
          '$lib/server/nodeKindDoor, or add this file to ALLOWED in ' +
          'scripts/check-node-write-doors.mjs with the reason it cannot.',
      );
    }
    // NAMING a door document, by any spelling at all. See doorReferences.
    //
    // ONE failure per LINE, not per occurrence. The walk sees the import
    // specifier and the use as two separate nodes, and a `.request(DOC, …)`
    // check used to report a third — three lines of red for one mistake, which
    // trains a reader to skim the gate's output. Grouping names every line the
    // author must edit, and names each of them once.
    const byLine = new Map();
    for (const site of references) {
      const names = byLine.get(site.line) ?? new Set();
      names.add(site.name);
      byLine.set(site.line, names);
    }
    for (const [line, names] of [...byLine].sort((a, b) => a[0] - b[0])) {
      failures.push(
        `${rel}:${line}  names ${[...names].join(', ')} — a node-update ` +
          'mutation is referenced only by $lib/server/nodeKindDoor. Call ' +
          "nodeUpdateDocument(node, input) so the door follows the node's kind, " +
          'or add this file to ALLOWED in scripts/check-node-write-doors.mjs ' +
          'with the reason it cannot.',
      );
    }
  }
  // An exemption that stops being used is an exemption nobody is reading any
  // more — a standing grant for whoever edits the file next. Keyed on the two
  // ways a file can hold a door at all, so one that routes its write but still
  // holds the document stays covered by its reason rather than reading clean.
  if (exempt && references.length === 0 && inline.length === 0) {
    failures.push(
      `${rel} is exempted in ALLOWED but no longer holds a node-update ` +
        'mutation — remove the entry.',
    );
  }

  return { failures, routed, looked: true };
}

/**
 * Run the gate over a file list.
 *
 * Returns { failures, routed, scanned } — `failures` is a list of strings, and
 * a non-empty list is a red gate.
 */
export function findDoorViolations(files, root, resolveDocument) {
  const failures = [];
  let routed = 0;
  let scanned = 0;

  for (const file of files) {
    // POSIX separators, because ALLOWED is keyed by path and a Windows checkout
    // would otherwise produce `src\\routes\\…` and match no entry — silently
    // turning every exemption into a violation, and every violation report into
    // a path no editor jump-to will open (@copilot on PR #869).
    const rel = relative(root, file).split(sep).join('/');
    if (rel === DOOR_MODULE) continue; // the chooser holds the documents by design
    // TEST files are excluded, and the floor is why. A test naming a door
    // document is doing its job — but counting its `nodeUpdateDocument` calls
    // toward MIN_ROUTED_CALL_SITES lets the gate satisfy its own anti-vacuity
    // check out of its own test suite. Measured while building this: deleting
    // every product call site still left 21 "routed writes", all of them
    // assertions. A floor a gate can meet by testing itself is not a floor.
    if (isTestFile(rel)) continue;
    const result = scanSource(rel, readFileSync(file, 'utf8'));
    if (!result.looked) continue;
    scanned += 1;
    routed += result.routed;
    failures.push(...result.failures);
  }

  if (scanned < MIN_FILES_SCANNED) {
    failures.push(
      `scanned ${scanned} files — the gate matched nothing at all, which means ` +
        'it is not looking where the code is, not that the code is clean.',
    );
  }
  if (routed < MIN_ROUTED_CALL_SITES) {
    failures.push(
      `found ${routed} routed node writes, expected at least ${MIN_ROUTED_CALL_SITES} — ` +
        'either call sites were removed (lower MIN_ROUTED_CALL_SITES and say why ' +
        'in the same commit) or they stopped going through the chooser, which is ' +
        'the regression this gate exists to catch.',
    );
  }
  failures.push(...doorVariablesAgree(resolveDocument));

  return { failures, routed, scanned };
}
