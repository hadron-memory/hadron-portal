import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { buildSchema, parse, validate, visit } from 'graphql';
import { readFileSync } from 'node:fs';
import Page from './+page.svelte';
import { GLOBAL_SEARCH_QUERY } from '$lib/server/queries';
const base = { q: 'AT0.6508', types: [], fields: [], error: null };
const hit = { entityType: 'agentTask', id: 'task-id', name: 'Repair the importer', handle: 'AT0.6508', urn: null, description: null, matchedField: 'name', memoryId: null, organizationId: null, score: 9 };
const html = (row: typeof hit) => render(Page, { props: { data: { ...base, result: { hits: [row], degraded: [] } } as never } }).body;
describe('task search presentation', () => {
 it('shows the returned title, handle and Task badge, and links null-URN tasks', () => {
  const out = html(hit);
  expect(out).toContain('Repair the importer');
  // The query input/title also contains the handle: only the result row proves it is displayed.
  expect(out.match(/<li\b[^>]*>([\s\S]*?)<\/li>/)?.[1]).toContain('AT0.6508');
  expect(out).toMatch(/>\s*Task\s*</); expect(out).toContain('href="/app/search?task=task-id"');
 });
 it('never guesses a handle from the title/id when none was returned', () => {
  const out = html({ ...hit, handle: null } as unknown as typeof hit);
  expect(out.match(/<li\b[^>]*>([\s\S]*?)<\/li>/)?.[1]).not.toContain('AT0.6508');
  expect(out).toContain('Repair the importer');
 });
 it('selects handle with a schema-valid GraphQL document', () => {
  const doc = parse(GLOBAL_SEARCH_QUERY); const fields: string[] = [];
  visit(doc, { Field(node) { fields.push(node.name.value); } });
  expect(fields).toContain('handle');
  expect(validate(buildSchema(readFileSync('schema/schema.graphql', 'utf8')), doc)).toEqual([]);
 });
});
