import { describe, expect, it } from 'vitest';
import { parse, type FieldNode, type SelectionSetNode } from 'graphql';
import { SESSIONS_QUERY } from '$lib/server/queries';

/**
 * Worker attribution on the org sessions list (hadron-server#980).
 *
 * This surface is org-wide, so `cor:agt:020:02` requires the app-qualified
 * compound ("eng-team/Iris") and forbids the bare short name — worker names are
 * unique only WITHIN an App, and a human org member may share one.
 *
 * The qualifier comes from the App's slug, which the portal reads off
 * `worker.app.urn`. That makes the selection set load-bearing in a way types
 * can't catch: every field is optional as far as TypeScript is concerned, and
 * dropping `app { urn }` doesn't fail a build, fail a query, or throw. It makes
 * `orgWideWorkerLabel` take its documented degradation path and render a bare
 * "Iris" on every row — silently reintroducing exactly the ambiguity the Worker
 * model exists to remove. Hence a test on the document itself.
 *
 * These assertions walk the PARSED AST rather than regex-matching the source.
 * The first version of this test matched the raw string and was a false
 * positive by construction: the explanatory `#` comments in SESSIONS_QUERY
 * themselves contain the words "name" and "retiredAt", so the guard passed
 * whether or not the fields were selected (Codex + Copilot, PR #717). Parsing
 * also scopes each assertion to the `worker` block, so an `app { urn }`
 * elsewhere in the document can't satisfy it either.
 *
 * (The label logic is unit-tested in src/lib/workers/worker-label.test.ts; this
 * pins that the data reaches it.)
 */

/** The named field within a selection set, or undefined. */
function field(selectionSet: SelectionSetNode | undefined, name: string): FieldNode | undefined {
  return selectionSet?.selections.find(
    (s): s is FieldNode => s.kind === 'Field' && s.name.value === name,
  );
}

/** The `worker` selection inside the `sessions` query. */
function workerSelection(): FieldNode {
  const doc = parse(SESSIONS_QUERY);
  const op = doc.definitions.find((d) => d.kind === 'OperationDefinition');
  if (op?.kind !== 'OperationDefinition') throw new Error('no operation in SESSIONS_QUERY');
  const sessions = field(op.selectionSet, 'sessions');
  expect(sessions, 'SESSIONS_QUERY should select `sessions`').toBeDefined();
  const worker = field(sessions!.selectionSet, 'worker');
  expect(worker, 'SESSIONS_QUERY should select `worker` on each session').toBeDefined();
  return worker!;
}

describe('SESSIONS_QUERY worker selection', () => {
  it('selects the worker name — the identity every surface renders', () => {
    expect(field(workerSelection().selectionSet, 'name')).toBeDefined();
  });

  it('selects worker.app.urn — the qualifier the compound is built from', () => {
    // Without this the org-wide rendering degrades to the bare name silently.
    const app = field(workerSelection().selectionSet, 'app');
    expect(app, '`worker.app` is where the App slug comes from').toBeDefined();
    expect(field(app!.selectionSet, 'urn'), '`worker.app.urn` carries the slug').toBeDefined();
  });

  it('selects retiredAt so a retired casting is not shown as current staff', () => {
    // Retirement ends the casting, not the history: the row must still
    // attribute, but must say the worker is retired.
    expect(field(workerSelection().selectionSet, 'retiredAt')).toBeDefined();
  });

  // Guards the guard: proves these assertions actually fail when the field is
  // gone, which the previous regex version did not.
  it('fails when a required subfield is dropped', () => {
    const withoutApp = parse(SESSIONS_QUERY.replace(/app\s*\{[^}]*\}/, ''));
    const op = withoutApp.definitions[0];
    if (op.kind !== 'OperationDefinition') throw new Error('unexpected');
    const worker = field(field(op.selectionSet, 'sessions')!.selectionSet, 'worker');
    expect(field(worker!.selectionSet, 'app')).toBeUndefined();
  });
});
