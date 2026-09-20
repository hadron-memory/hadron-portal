// The node-write DOOR gate (#868).
//
// `src/lib/server/nodeKindDoor.ts` picks the mutation a node update goes
// through. A helper makes the right thing easy; it does not make the wrong
// thing impossible, and "remember to call the chooser" written in a comment is
// enforced by whoever happens to read that file
// (review:comment-cannot-enforce-a-per-instance-rule). Eight call sites each
// remembering to route is the shape that produced #868 in the first place.
//
// So this gate inverts the default: naming a node-update mutation document at a
// `.request(...)` call site FAILS unless the call site is in ALLOWED below,
// with a reason. A tenth call site added next year has to opt out, visibly, in
// a file a reviewer reads — rather than opt in silently and be refused in
// production against the first governed node it meets.
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
import { relative } from 'node:path';
import ts from 'typescript';
import { parse } from 'graphql';

/** The mutation documents that write a node. Every one must go through the chooser. */
export const DOOR_DOCUMENTS = [
  'UPDATE_NODE_MUTATION',
  'UPDATE_TASK_NODE_MUTATION',
  'UPDATE_REVIEW_NODE_MUTATION',
  'UPDATE_SPEC_NODE_MUTATION',
];

/** The chooser itself — the one place allowed to hold the documents. */
export const DOOR_MODULE = 'src/lib/server/nodeKindDoor.ts';

/**
 * EXACT call sites exempted, each with the reason it is not routed.
 *
 * An exact list, never a pattern: a pattern is a hiding place, because the next
 * file that happens to match inherits an exemption nobody granted it
 * (review:exception-lists-not-patterns-in-ratchets). Keyed by file, so moving a
 * call within a file does not silently re-grant it — the file is the unit a
 * reviewer actually reads.
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
 * Every `<x>.request(DOC, …)` naming a door document, and every
 * `nodeUpdateDocument(…)` call, in one file.
 */
function doorCallSites(source) {
  const direct = [];
  let routed = 0;

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      // `nodeUpdateDocument(prior, input)` — a routed write.
      if (ts.isIdentifier(node.expression) && node.expression.text === 'nodeUpdateDocument') {
        routed += 1;
      }
      // `<anything>.request(DOC, …)` / `.request<T>(DOC, …)` — matched the same
      // way check-graphql-callers matches it, since the portal annotates the
      // response type inline on most of these.
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'request'
      ) {
        const docArg = node.arguments[0];
        if (docArg && ts.isIdentifier(docArg) && DOOR_DOCUMENTS.includes(docArg.text)) {
          direct.push({
            name: docArg.text,
            line: source.getLineAndCharacterOfPosition(docArg.getStart(source)).line + 1,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { direct, routed };
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
export function doorVariablesAgree(resolve) {
  const signatures = new Map();
  for (const name of DOOR_DOCUMENTS) {
    const text = resolve(name);
    if (text === undefined) {
      return [`${name} is not defined in src/lib/server/queries.ts`];
    }
    const op = parse(text).definitions.find((d) => d.kind === 'OperationDefinition');
    if (!op) return [`${name} declares no operation`];
    const vars = (op.variableDefinitions ?? [])
      .map((v) => `$${v.variable.name.value}`)
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
 * test can name (review:ci-gate-prefilter-must-be-proven).
 */
export function scanSource(rel, text) {
  // No pre-filter on `.request(`: skipping files by substring is how the caller
  // gate went blind to 46 of them. The only skip is "this file names none of
  // the identifiers we care about at all" — which cannot hide a violation,
  // because a violation has to name a door document to be one.
  if (
    !DOOR_DOCUMENTS.some((d) => text.includes(d)) &&
    !text.includes('nodeUpdateDocument')
  ) {
    return { failures: [], routed: 0, looked: false };
  }

  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const { direct, routed } = doorCallSites(source);
  const failures = [];
  const reason = ALLOWED.get(rel);

  for (const site of direct) {
    if (reason) continue;
    failures.push(
      `${rel}:${site.line}  writes a node through ${site.name} directly — ` +
        'call nodeUpdateDocument(node, input) from $lib/server/nodeKindDoor ' +
        'so the door follows the node\'s kind, or add this file to ALLOWED in ' +
        'scripts/check-node-write-doors.mjs with the reason it cannot.',
    );
  }
  // An exemption that stops being used is an exemption nobody is reading any
  // more — report it rather than leave a stale grant standing.
  if (reason && direct.length === 0) {
    failures.push(
      `${rel} is exempted in ALLOWED but no longer writes a node directly — ` +
        'remove the entry.',
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
    const rel = relative(root, file);
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
