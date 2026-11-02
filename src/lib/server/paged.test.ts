import { describe, expect, it, vi } from 'vitest';
import { MAX_PAGES, MAX_RESTARTS, PAGE_SIZE, PagingError, readAllPages } from './paged';

const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `k${i}` }));
const server = (all: { id: string }[]) =>
  vi.fn(async (limit: number, offset: number) => ({
    items: all.slice(offset, offset + limit),
    total: all.length,
    hasMore: offset + limit < all.length,
  }));

describe('readAllPages', () => {
  it.each([0, 1, 20, 21, 45, 201, 450])('returns all %i rows, never asking for more than 20', async (n) => {
    const read = server(rows(n));
    const got = await readAllPages(read);
    expect(got.map((r) => r.id)).toEqual(rows(n).map((r) => r.id));
    for (const [limit] of read.mock.calls) expect(limit).toBeLessThanOrEqual(PAGE_SIZE);
    expect(read).toHaveBeenCalledTimes(n <= PAGE_SIZE ? 1 : Math.ceil(n / PAGE_SIZE) + 1);
  });
  it('a refused later page throws and yields no partial list', async () => {
    const read = vi.fn(async (_l: number, offset: number) => {
      if (offset >= 20) throw new Error('FORBIDDEN');
      return { items: rows(20), total: 60, hasMore: true };
    });
    await expect(readAllPages(read)).rejects.toThrow('FORBIDDEN');
  });
  it('a refused first page throws', async () => {
    await expect(readAllPages(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
  });
  it('hasMore with an empty page throws instead of looping', async () => {
    await expect(readAllPages(async () => ({ items: [], total: 5, hasMore: true }))).rejects.toBeInstanceOf(PagingError);
  });
  it('a server that repeats the same rows throws instead of looping', async () => {
    await expect(readAllPages(async () => ({ items: rows(20), total: 99, hasMore: true }))).rejects.toBeInstanceOf(PagingError);
  });
  it('a row shifted onto the next page is kept once', async () => {
    const pages = [
      { items: rows(20), total: 21, hasMore: true },
      { items: [rows(20)[19], { id: 'new' }], total: 21, hasMore: false },
      { items: rows(20), total: 21, hasMore: true },
    ];
    let i = 0;
    const got = await readAllPages(async () => pages[i++]);
    expect(got.map((r) => r.id)).toEqual([...rows(20).map((r) => r.id), 'new']);
  });
  it('bounds a server that always says hasMore', async () => {
    let n = 0;
    const read = vi.fn(async () => ({ items: [{ id: `x${n++}` }], total: 1e9, hasMore: true }));
    await expect(readAllPages(read)).rejects.toBeInstanceOf(PagingError);
    expect(read).toHaveBeenCalledTimes(MAX_PAGES);
  });

  // §10 P2 (Ralion, #1617): a live key must never drop out because the list shifted under the loop.
  describe('a list that changes while it is read', () => {
    const ids = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `k${from + i}` }));
    // A server over a mutable array, with a hook before each page.
    const mutable = (all: { id: string }[], before: (call: number) => void) => {
      let call = 0;
      return vi.fn(async (limit: number, offset: number) => {
        before(call++);
        return { items: all.slice(offset, offset + limit), total: all.length, hasMore: offset + limit < all.length };
      });
    };
    it('a key revoked on an already-read page restarts the read and loses no live key', async () => {
      const all = ids(30);
      let done = false;
      const read = mutable(all, (call) => { if (call === 1 && !done) { done = true; all.splice(3, 1); } });
      const got = await readAllPages(read);
      expect(got.map((r) => r.id)).toEqual(all.map((r) => r.id));
      expect(got.map((r) => r.id)).toContain('k20');
    });
    it('a revoke plus a create (same total) is still caught: no live key is missing', async () => {
      const all = ids(30);
      let done = false;
      const read = mutable(all, (call) => { if (call === 1 && !done) { done = true; all.splice(3, 1); all.unshift({ id: 'fresh' }); } });
      const got = await readAllPages(read);
      expect(got.map((r) => r.id).sort()).toEqual(all.map((r) => r.id).sort());
    });
    it('a key added on an already-read page is not duplicated and is not lost', async () => {
      const all = ids(30);
      let done = false;
      const read = mutable(all, (call) => { if (call === 1 && !done) { done = true; all.unshift({ id: 'fresh' }); } });
      const got = await readAllPages(read);
      expect(got.map((r) => r.id).sort()).toEqual(all.map((r) => r.id).sort());
    });
    it('a list that never settles throws instead of showing a partial list', async () => {
      const all = ids(60);
      let n = 0;
      const read = mutable(all, () => { all.splice(0, 1); all.push({ id: `n${n++}` }); all.splice(1, 1); });
      await expect(readAllPages(read)).rejects.toBeInstanceOf(PagingError);
    });
    it('restarts are bounded', async () => {
      const all = ids(60);
      let n = 0;
      const read = mutable(all, () => { all.splice(0, 1); all.push({ id: `m${n++}` }); all.splice(1, 1); });
      await readAllPages(read).catch(() => {});
      expect(read.mock.calls.length).toBeLessThanOrEqual((MAX_RESTARTS + 1) * 3);
    });
  });
  it('the no-progress guard: hasMore with only already-seen rows throws (pinned)', async () => {
    const pages = [{ items: rows(20), total: 40, hasMore: true }, { items: rows(20), total: 40, hasMore: true }];
    let i = 0;
    await expect(readAllPages(async () => pages[Math.min(i++, 1)])).rejects.toBeInstanceOf(PagingError);
  });
});
