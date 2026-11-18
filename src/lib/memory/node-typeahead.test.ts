import { describe, expect, it, vi } from 'vitest';
import {
  scheduleTypeahead,
  searchMemoryNodes,
  targetUrnOptions,
  TYPEAHEAD_DEBOUNCE_MS,
  TYPEAHEAD_LIMIT,
  type TypeaheadNode,
} from './node-typeahead';

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

// #1438 BLIND P3: the picker effects' rules, now testable outside the component.
describe('scheduleTypeahead', () => {
  const hit = (id: string): TypeaheadNode => ({ id, loc: `p:${id}`, name: id, memoryId: 'mem-1' });

  function harness(answer: TypeaheadNode[] = [hit('a'), hit('self'), hit('b')]) {
    const search = vi.fn(async () => answer);
    const onHits = vi.fn();
    const run = (query: string, skip?: (q: string) => boolean) =>
      scheduleTypeahead({ query, memoryId: 'mem-1', selfId: 'self', onHits, search, skip });
    return { search, onHits, run };
  }

  it('fewer than 2 characters clears the hits and asks nothing', async () => {
    vi.useFakeTimers();
    try {
      const { search, onHits, run } = harness();
      run(' a ');
      await vi.advanceTimersByTimeAsync(TYPEAHEAD_DEBOUNCE_MS * 2);
      expect(onHits).toHaveBeenCalledWith([]);
      expect(search).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a skipped input (a typed URN) clears the hits and asks nothing', async () => {
    vi.useFakeTimers();
    try {
      const { search, onHits, run } = harness();
      run('hrn:node:x.test:m:a', (q) => q.startsWith('hrn:'));
      await vi.advanceTimersByTimeAsync(TYPEAHEAD_DEBOUNCE_MS * 2);
      expect(onHits).toHaveBeenCalledWith([]);
      expect(search).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('debounces a keystroke burst into one search for the last query, without the picker\'s own node', async () => {
    vi.useFakeTimers();
    try {
      const { search, onHits, run } = harness();
      let cleanup = run('au');
      cleanup();
      cleanup = run('aut');
      cleanup();
      run(' auth ');
      await vi.advanceTimersByTimeAsync(TYPEAHEAD_DEBOUNCE_MS - 1);
      expect(search).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(search).toHaveBeenCalledTimes(1);
      expect(search).toHaveBeenCalledWith('mem-1', 'auth');
      expect(onHits).toHaveBeenCalledWith([hit('a'), hit('b')]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('discards an answer that lands after cleanup (stale), and delivers one that lands before', async () => {
    vi.useFakeTimers();
    try {
      let release!: (v: TypeaheadNode[]) => void;
      const search = vi.fn(() => new Promise<TypeaheadNode[]>((r) => (release = r)));
      const onHits = vi.fn();
      const cleanup = scheduleTypeahead({ query: 'au', memoryId: 'mem-1', selfId: 'self', onHits, search });
      await vi.advanceTimersByTimeAsync(TYPEAHEAD_DEBOUNCE_MS);
      cleanup();
      release([hit('late')]);
      await Promise.resolve();
      expect(onHits).not.toHaveBeenCalled();

      scheduleTypeahead({ query: 'au', memoryId: 'mem-1', selfId: 'self', onHits, search });
      await vi.advanceTimersByTimeAsync(TYPEAHEAD_DEBOUNCE_MS);
      release([hit('fresh')]);
      await Promise.resolve();
      expect(onHits).toHaveBeenCalledWith([hit('fresh')]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('targetUrnOptions', () => {
  // The search endpoint can answer an unnamed node with name: null whatever the type says.
  const hits: TypeaheadNode[] = [{ id: 'n1', loc: 'specs:auth', name: 'Auth', memoryId: 'm' }, { id: 'n2', loc: 'x', name: null as unknown as string, memoryId: 'm' }];

  it('composes each hit\'s URN under the memory URN, labelled by name or loc', () => {
    const opts = targetUrnOptions(hits, 'hrn:mem:x.test:m', (m, l) => `${m.replace('hrn:mem:', 'hrn:node:')}:${l}`);
    expect(opts).toEqual([
      { urn: 'hrn:node:x.test:m:specs:auth', name: 'Auth' },
      { urn: 'hrn:node:x.test:m:x', name: 'x' },
    ]);
  });

  it('falls back to the bare loc when the memory URN is absent or cannot be composed, instead of throwing', () => {
    const throwing = () => {
      throw new Error('malformed memory URN');
    };
    expect(targetUrnOptions(hits, 'garbage', throwing).map((o) => o.urn)).toEqual(['specs:auth', 'x']);
    expect(targetUrnOptions(hits, null, throwing).map((o) => o.urn)).toEqual(['specs:auth', 'x']);
  });
});
