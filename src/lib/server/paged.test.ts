import { describe, expect, it, vi } from 'vitest';
import { MAX_PAGES, PAGE_SIZE, PagingError, readAllPages } from './paged';

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
    expect(read).toHaveBeenCalledTimes(Math.max(1, Math.ceil(n / PAGE_SIZE)));
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
});
