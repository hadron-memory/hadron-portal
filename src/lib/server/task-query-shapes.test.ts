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
import { buildSchema, parse, validate } from 'graphql';
import { describe, expect, it } from 'vitest';
import {
  CREATE_SCOPE_MUTATION,
  DELETE_SCOPE_MUTATION,
  RUNNABLE_NODES_QUERY,
  SKILL_PLAN_EXPORT_QUERY,
} from '$lib/server/queries';

const schema = buildSchema(readFileSync('schema/schema.graphql', 'utf8'));
const errors = (doc: string) => validate(schema, parse(doc)).map((e) => e.message);

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
});
