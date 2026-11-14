import { describe, expect, it } from 'vitest';
import { parse, print, visit } from 'graphql';
import { GLOBAL_SEARCH_QUERY } from '$lib/server/queries';
import { searchHitFields, searchResult } from './search-assertions';

describe('the search query guard examines the consumed hits selection', () => {
  it('accepts the real query and fails when its handle selection is removed', () => {
    expect(searchHitFields(GLOBAL_SEARCH_QUERY)).toContain('handle');
    const withoutHandle = visit(parse(GLOBAL_SEARCH_QUERY), {
      Field(node) { return node.name.value === 'handle' ? null : undefined; },
    });
    expect(searchHitFields(print(withoutHandle))).not.toContain('handle');
  });

  it.each([
    ['another root field', 'query GlobalSearch { globalSearch(query: "q") { hits { id name } } user(id: "x") { handle } }'],
    ['another operation', 'query Other { globalSearch(query: "q") { hits { handle } } } query GlobalSearch { globalSearch(query: "q") { hits { id name } } }'],
    ['a renamed handle response', 'query GlobalSearch { globalSearch(query: "q") { hits { renamed: handle } } }'],
    ['another aliased result', 'query GlobalSearch { other: globalSearch(query: "q") { hits { handle } } globalSearch(query: "q") { hits { id name } } }'],
  ])('ignores handle in %s', (_label, query) => {
    expect(searchHitFields(query)).not.toContain('handle');
  });
});

describe('the search result guard selects the linked row, never the first row', () => {
  const target = '/app/search?task=target';
  const markup = `<ul>
    <li><a href="/other">Decoy</a><span>AT0.9999</span></li>
    <li><a href="${target}">Task title</a><span>AT0.6508</span></li>
  </ul>`;

  it('reads the target row even when a decoy precedes it', () => {
    const row = searchResult(markup, target);
    expect(row.text).toContain('Task title');
    expect(row.text).toContain('AT0.6508');
    expect(row.text).not.toContain('AT0.9999');
  });

  it('fails when the expected result link is absent', () => {
    expect(() => searchResult(markup, '/missing')).toThrow('Search result row missing');
  });
});
