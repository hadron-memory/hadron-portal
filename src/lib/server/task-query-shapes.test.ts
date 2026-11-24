/**
 * #1075 — the two Task Nodes operations that drifted from the server, pinned
 * against the committed schema snapshot rather than against our own mocks.
 *
 * A mock answers whatever shape the code sends, so a stale query passes every
 * handler test and fails only on a live stack. The snapshot is the server's
 * word for the shape, and the drifted forms below are asserted to be REFUSED
 * so this file cannot go green on a validator that accepts everything.
 */
import { readFileSync } from 'node:fs';
import { buildSchema, Kind, parse, validate, type FieldNode } from 'graphql';
import { describe, expect, it } from 'vitest';
import { MEMORY_ASSETS_QUERY } from '$lib/server/assetQueries';
import {
  CANCEL_APP_RUN_MUTATION,
  CREATE_SCOPE_MUTATION,
  DELETE_NODE_REVISION_MUTATION,
  NODE_REVISION_PROVENANCE_QUERY,
  NODE_REVISION_QUERY,
  RESTORE_NODE_REVISION_MUTATION,
  UPDATE_NODE_REVISION_MUTATION,
  APP_RUNS_QUERY,
  DELETE_SCOPE_MUTATION,
  ORG_APP_RUNS_QUERY,
  ORG_SYSTEM_MEMORY_IDS_QUERY,
  RUNNABLE_NODES_QUERY,
  SKILL_PLAN_EXPORT_QUERY,
  USAGE_EVENTS_QUERY,
} from '$lib/server/queries';

const schema = buildSchema(readFileSync('schema/schema.graphql', 'utf8'));
const errors = (doc: string) => validate(schema, parse(doc)).map((e) => e.message);

/** The response keys an operation selects DIRECTLY under `field` (nested selections do not count; an alias renames the key). */
function directSelections(query: string, field: string): string[] {
  const out: string[] = [];
  const walk = (set: { selections: readonly import('graphql').SelectionNode[] } | undefined): void => {
    for (const sel of set?.selections ?? []) {
      if (sel.kind !== Kind.FIELD) {
        // fragments/inline fragments: look inside inline fragments, same level
        if (sel.kind === Kind.INLINE_FRAGMENT) walk(sel.selectionSet);
        continue;
      }
      const node: FieldNode = sel;
      if (node.name.value === field) {
        for (const child of node.selectionSet?.selections ?? []) {
          // The RESPONSE key is what the helper reads: `appId: id` serves the
          // key `appId` from the wrong field, and `id: appId` drops the key.
          if (child.kind === Kind.FIELD) out.push(child.alias?.value ?? child.name.value);
        }
      }
      walk(node.selectionSet);
    }
  };
  for (const def of parse(query).definitions) {
    if (def.kind === Kind.OPERATION_DEFINITION) walk(def.selectionSet);
  }
  return out;
}

describe('#1075 Task Nodes operations match the server snapshot', () => {
  it('findNodes takes memoryIds inside `filter`, never as a top-level argument', () => {
    expect(errors(RUNNABLE_NODES_QUERY)).toEqual([]);
    expect(RUNNABLE_NODES_QUERY).toMatch(/findNodes\(\s*filter:\s*\{[^}]*memoryIds:\s*\$memoryIds/);
    // The drifted form is refused by the same validator.
    const drifted = RUNNABLE_NODES_QUERY.replace(
      'filter: { memoryIds: $memoryIds, isRunnable: true }',
      'memoryIds: $memoryIds, filter: { isRunnable: true }',
    );
    expect(drifted).not.toBe(RUNNABLE_NODES_QUERY);
    expect(errors(drifted).join('\n')).toContain('Unknown argument "memoryIds" on field "Query.findNodes"');
  });

  it('skillPlan EXPORT selects memories by scopeRef, never by `memories`', () => {
    expect(errors(SKILL_PLAN_EXPORT_QUERY)).toEqual([]);
    expect(SKILL_PLAN_EXPORT_QUERY).toContain('scopeRef: $scopeRef');
    expect(SKILL_PLAN_EXPORT_QUERY).toContain('$scopeRef: ID!');
    expect(SKILL_PLAN_EXPORT_QUERY).not.toMatch(/\bmemories\b/);
  });

  it('the scope the export is named by is created and deleted with the snapshot\'s own shapes', () => {
    expect(errors(CREATE_SCOPE_MUTATION)).toEqual([]);
    expect(errors(DELETE_SCOPE_MUTATION)).toEqual([]);
    expect(errors('mutation M { createScope(input: { name: "x" }) { id } }').join('\n')).toContain('memoryRefs');
  });

  // #1706 — the helper's install-memory filter reads `appId`, so the field must
  // be on the snapshot's Memory type AND inside this selection; a dropped
  // `appId` (snapshot refresh against an older server) must fail HERE, not as
  // undefined-bytes on a live stack. Parser-based and order-free: the field
  // must be a DIRECT selection of items, however it is formatted.
  it('#1706: the system-memory ids query selects Memory.appId from the snapshot', () => {
    expect(errors(ORG_SYSTEM_MEMORY_IDS_QUERY)).toEqual([]);
    expect(directSelections(ORG_SYSTEM_MEMORY_IDS_QUERY, 'items')).toContain('appId');
    // A selection the snapshot refuses cannot hold this file green.
    expect(errors('query Q { memories { items { noSuchField } } }').join('\n')).toContain('Cannot query field "noSuchField"');
  });

  // The pin must separate a DIRECT selection from a nested one, which the old
  // brace-bounded regex could not (#1708).
  it('#1708: the items pin counts direct selections only', () => {
    expect(directSelections('query Q { memories { items { id app { appId } } } }', 'items')).not.toContain('appId');
    expect(directSelections('query Q { memories { items { id foo { bar } appId } } }', 'items')).toContain('appId');
    expect(directSelections('query Q { memories { items { id } } }', 'items')).not.toContain('appId');
    // An alias removes the `appId` response key the org-memory filter reads (Beckett, #2409).
    expect(directSelections('query Q { memories { items { id other: appId } } }', 'items')).not.toContain('appId');
  });
});

// portal#2498: hadron-server#4141 S5 (hadron-server#4789) renamed cancelAppRun's
// argument `id` -> `ref`, a hard rename with no alias (spec
// hrn:node:hadronmemory.com:specs:cor:api:140:01). The kill switch is the run
// page's cancel button, so a stale document would pass every handler test (the
// mock answers whatever shape it is sent) and fail only on a live stack. Pinned
// against the snapshot at the server head this PR stamps. The validator is the
// proof; the drifted form is asserted refused so it cannot go green on a
// validator that accepts everything.
describe('portal#2498 cancelAppRun matches the server snapshot', () => {
  it('cancelAppRun is called with `ref`, never `id`', () => {
    expect(errors(CANCEL_APP_RUN_MUTATION)).toEqual([]);
    const drifted = CANCEL_APP_RUN_MUTATION.replace('cancelAppRun(ref: $ref)', 'cancelAppRun(id: $ref)');
    expect(drifted).not.toBe(CANCEL_APP_RUN_MUTATION);
    // Only that the drift is refused naming the argument, not graphql-js's exact sentence.
    expect(errors(drifted).join('\n')).toMatch(/Unknown argument "id"/);
  });
});

// #2588 — hadron-server#4142 S6 chunk A (PR #4822) renamed the memory reads'
// `memoryId` / `nodeId` arguments to `memoryRef` / `nodeRef`, a hard rename with
// no alias (hrn:node:hadronmemory.com:specs:cor:api:140:01). A stale document
// would pass every handler test (the mock answers whatever shape it is sent)
// and fail only on a live stack with an unknown-argument error. One pin per
// renamed operation the portal calls; the drifted form of each is asserted
// REFUSED so the pin cannot go green on a validator that accepts everything.
// `usageEventsPage` and `memoryLocSegments` are renamed by the same PR but the
// portal sends neither (no document names them).
describe('#2588 the S6 chunk A reads match the server snapshot', () => {
  it('usageEvents is called with `memoryRef`, never `memoryId`', () => {
    expect(errors(USAGE_EVENTS_QUERY)).toEqual([]);
    expect(USAGE_EVENTS_QUERY).toContain('memoryRef: $memoryRef');
    expect(USAGE_EVENTS_QUERY).toContain('$memoryRef: ID');
    expect(USAGE_EVENTS_QUERY).not.toMatch(/usageEvents\([^)]*memoryId:/);
    const drifted = USAGE_EVENTS_QUERY.replace('memoryRef: $memoryRef', 'memoryId: $memoryRef');
    expect(drifted).not.toBe(USAGE_EVENTS_QUERY);
    expect(errors(drifted).join('\n')).toContain('Unknown argument "memoryId" on field "Query.usageEvents"');
  });

  it('memoryAssets is called with `memoryRef`, never `memoryId`', () => {
    expect(errors(MEMORY_ASSETS_QUERY)).toEqual([]);
    expect(MEMORY_ASSETS_QUERY).toContain('memoryAssets(memoryRef: $memoryRef');
    expect(MEMORY_ASSETS_QUERY).toContain('$memoryRef: ID!');
    expect(MEMORY_ASSETS_QUERY).not.toMatch(/memoryAssets\(\s*memoryId:/);
    const drifted = MEMORY_ASSETS_QUERY.replace('memoryAssets(memoryRef: $memoryRef', 'memoryAssets(memoryId: $memoryRef');
    expect(drifted).not.toBe(MEMORY_ASSETS_QUERY);
    expect(errors(drifted).join('\n')).toContain('Unknown argument "memoryId" on field "Query.memoryAssets"');
  });
});

// #2588 blind P2: the snapshot at the #4822 head also carries `appRuns(parentRunId)`
// -> `parentRunRef` (hadron-server#4141, picked up by the same snapshot refresh,
// not by #4822). Grepped: no portal document sends that argument (the only
// `parentRunId` in a document is the AppRun response FIELD, which the server
// keeps), so there is nothing to rename. This pins that, so a future caller that
// filters by parent run has to use the new name.
describe('#2588 appRuns never sends the renamed `parentRunId` argument', () => {
  it.each([
    ['APP_RUNS_QUERY', APP_RUNS_QUERY],
    ['ORG_APP_RUNS_QUERY', ORG_APP_RUNS_QUERY],
  ])('%s validates and passes no parentRunId argument', (_name, doc) => {
    expect(errors(doc)).toEqual([]);
    expect(doc).not.toMatch(/appRuns\([^)]*parentRun(Id|Ref):/);
    const drifted = doc.replace(/appRuns\(/, 'appRuns(parentRunId: $p, ');
    expect(drifted).not.toBe(doc);
    expect(errors(drifted).join('\n')).toContain('Unknown argument "parentRunId" on field "Query.appRuns"');
  });
});

// #2476 — hadron-server#4766 (#4138) renamed the node-revision calls' `revisionId`
// argument to `nodeRevRef`, a hard rename with no alias, and declared it
// `String!` (the ref family's default scalar is `ID!`, so the variable type is
// taken from the snapshot, not from the family: an `ID!` variable passed to a
// `String!` argument fails validation). A stale document passes every handler
// test (the mock answers whatever it is sent) and fails only on a live stack
// with an unknown-argument error, so each of the five calls the portal makes is
// pinned against the snapshot, and its drifted form is asserted REFUSED.
// `nodeRevisions` and `nodeRevisionsPage` take `nodeRef` and are unchanged.
describe('#2476 the node-revision calls take `nodeRevRef`', () => {
  it.each([
    ['NODE_REVISION_QUERY', NODE_REVISION_QUERY, 'nodeRevision', 'Query'],
    ['NODE_REVISION_PROVENANCE_QUERY', NODE_REVISION_PROVENANCE_QUERY, 'nodeRevision', 'Query'],
    ['RESTORE_NODE_REVISION_MUTATION', RESTORE_NODE_REVISION_MUTATION, 'restoreNodeRevision', 'Mutation'],
    ['DELETE_NODE_REVISION_MUTATION', DELETE_NODE_REVISION_MUTATION, 'deleteNodeRevision', 'Mutation'],
    ['UPDATE_NODE_REVISION_MUTATION', UPDATE_NODE_REVISION_MUTATION, 'updateNodeRevision', 'Mutation'],
  ])('%s validates, passes `nodeRevRef: $nodeRevRef` typed String!, never `revisionId`', (_name, doc, field, root) => {
    expect(errors(doc)).toEqual([]);
    expect(doc).toContain('$nodeRevRef: String!');
    expect(doc).toContain(`${field}(nodeRevRef: $nodeRevRef`);
    expect(doc).not.toContain('revisionId');
    const drifted = doc.replace('nodeRevRef: $nodeRevRef', 'revisionId: $nodeRevRef');
    expect(drifted).not.toBe(doc);
    expect(errors(drifted).join('\n')).toContain(`Unknown argument "revisionId" on field "${root}.${field}"`);
    const wrongType = doc.replace('$nodeRevRef: String!', '$nodeRevRef: ID!');
    expect(wrongType).not.toBe(doc);
    expect(errors(wrongType).join('\n')).toContain('$nodeRevRef');
  });
});
