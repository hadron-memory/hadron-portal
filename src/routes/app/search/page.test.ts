import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { buildSchema, parse, validate } from 'graphql';
import { readFileSync } from 'node:fs';
import Page from './+page.svelte';
import type { SearchHit } from './+page.server';
import { GLOBAL_SEARCH_QUERY } from '$lib/server/queries';
import { searchHitFields, searchResult } from '$lib/test/search-assertions';

const base = { q: 'AT0.6508', types: [], fields: [], error: null };
const hit: SearchHit = {
  entityType: 'agentTask',
  id: 'task-id',
  name: 'Repair the importer',
  handle: 'AT0.6508',
  urn: null,
  description: null,
  matchedField: 'name',
  memoryId: null,
  organizationId: null,
  score: 9,
};
const target = '/app/search?task=task-id';
const html = (hits: SearchHit[]) => render(Page, {
  props: { data: { ...base, result: { hits, degraded: [] } } as never },
}).body;
const schema = buildSchema(readFileSync(new URL('../../../../schema/schema.graphql', import.meta.url), 'utf8'));

describe('task search presentation', () => {
  it('shows the returned title, handle and Task badge, and links null-URN tasks', () => {
    const decoy: SearchHit = { ...hit, entityType: 'user', id: 'other-id', name: 'Decoy', handle: null };
    const row = searchResult(html([decoy, hit]), target);
    expect(row.text).toContain('Repair the importer');
    // The query input/title also contains the handle; only the linked row proves it is displayed.
    expect(row.text).toContain('AT0.6508');
    expect(row.html).toMatch(/>\s*Task\s*</);
    expect(row.html).toContain(`href="${target}"`);
  });

  it('never guesses a handle from the title/id when none was returned', () => {
    const row = searchResult(html([{ ...hit, handle: null }]), target);
    expect(row.text).not.toContain('AT0.6508');
    expect(row.text).toContain('Repair the importer');
  });

  it('selects handle on the consumed hits path in a schema-valid GraphQL document', () => {
    expect(searchHitFields(GLOBAL_SEARCH_QUERY)).toContain('handle');
    expect(validate(schema, parse(GLOBAL_SEARCH_QUERY))).toEqual([]);
  });
});
