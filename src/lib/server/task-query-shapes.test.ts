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
import {
  CREATE_SCOPE_MUTATION,
  DELETE_SCOPE_MUTATION,
  ORG_SYSTEM_MEMORY_IDS_QUERY,
  RUNNABLE_NODES_QUERY,
  SKILL_PLAN_EXPORT_QUERY,
} from '$lib/server/queries';

const schema = buildSchema(readFileSync('schema/schema.graphql', 'utf8'));
const errors = (doc: string) => validate(schema, parse(doc)).map((e) => e.message);

/** The fields an operation selects DIRECTLY under `field` (nested selections do not count). */
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
          if (child.kind === Kind.FIELD) out.push(child.name.value);
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
  });
});
