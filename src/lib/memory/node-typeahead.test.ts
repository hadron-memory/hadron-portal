import { describe, expect, it, vi } from 'vitest';
import { searchMemoryNodes, TYPEAHEAD_LIMIT } from './node-typeahead';

// portal#1433 acceptance 3: the edit-mode pickers' typeahead returns at most 20
// matches from the bounded node search, and never a node of another memory.
const row = (i: number, memoryId = 'mem-1') => ({ id: `n${i}`, loc: `p:n${i}`, name: `N${i}`, memoryId });

function fetchReturning(nodes: unknown[], ok = true) {
  return vi.fn(async () => ({ ok, json: async () => ({ nodes }) }) as unknown as Response);
}

describe('searchMemoryNodes', () => {
  it('asks the search endpoint for THIS memory with limit 20', async () => {
    const f = fetchReturning([]);
    await searchMemoryNodes('mem-1', '  auth  ', f);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/nodes/search');
    expect(JSON.parse(init.body as string)).toEqual({ query: 'auth', memoryIds: ['mem-1'], limit: TYPEAHEAD_LIMIT });
    expect(TYPEAHEAD_LIMIT).toBe(20);
  });

  it('returns at most 20 even when the answer carries more', async () => {
    const hits = await searchMemoryNodes('mem-1', 'p', fetchReturning(Array.from({ length: 30 }, (_, i) => row(i))));
    expect(hits).toHaveLength(20);
  });

  it('never offers a node from another memory', async () => {
    const hits = await searchMemoryNodes('mem-1', 'p', fetchReturning([row(1), row(2, 'mem-2'), row(3)]));
    expect(hits.map((h) => h.id)).toEqual(['n1', 'n3']);
  });

  it('a blank query asks nothing', async () => {
    const f = fetchReturning([row(1)]);
    expect(await searchMemoryNodes('mem-1', '   ', f)).toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('a failed search is "no suggestions", not an error', async () => {
    expect(await searchMemoryNodes('mem-1', 'p', fetchReturning([row(1)], false))).toEqual([]);
    const throwing = vi.fn(async () => { throw new Error('offline'); });
    expect(await searchMemoryNodes('mem-1', 'p', throwing as unknown as typeof fetch)).toEqual([]);
  });
});
