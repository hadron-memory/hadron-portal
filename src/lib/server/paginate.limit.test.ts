/**
 * hadron-server#2381 — the portal's `ORGANIZATIONS_QUERY` nests four unpaged lists per organization row, so its
 * request cost grows with the page size. The server's default admission budget is 200000 and the query costs about
 * 4002 per row (measured with the server's own estimator: 80045 at 20 rows, 200111 at 50, 800441 at 200), so the
 * 200-row page every other list uses is refused. The same data comes back in smaller pages.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { fetchAllItems, ORGANIZATIONS_PAGE_LIMIT, PAGE_LIMIT } from './paginate';
import { ORGANIZATIONS_QUERY } from './queries';

/** A server holding `n` rows, honouring limit/offset. */
function serverOf(n: number) {
  const all = Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));
  const request = vi.fn(async (_doc: string, v: { limit: number; offset: number }) => ({
    organizations: { items: all.slice(v.offset, v.offset + v.limit), total: n },
  }));
  return { client: { request } as unknown as GraphQLClient, request };
}

describe('fetchAllItems page size (#2381)', () => {
  it('pages ORGANIZATIONS_QUERY in pages that fit the server admission budget, and still returns every row', async () => {
    const { client, request } = serverOf(95);
    const out = await fetchAllItems<{ id: string }>(client, ORGANIZATIONS_QUERY, 'organizations');
    expect(out).toHaveLength(95);
    expect(new Set(out.map((o) => o.id)).size).toBe(95);
    const limits = request.mock.calls.map((c) => c[1].limit);
    expect(Math.max(...limits)).toBeLessThanOrEqual(ORGANIZATIONS_PAGE_LIMIT);
    expect(ORGANIZATIONS_PAGE_LIMIT).toBeLessThanOrEqual(40);
    expect(request.mock.calls.map((c) => c[1].offset)).toEqual([0, 40, 80]);
  });

  it('keeps the 200-row page for a document that has no override', async () => {
    const { client, request } = serverOf(5);
    await fetchAllItems(client, '{ organizations { items { id } total } }', 'organizations');
    expect(request.mock.calls[0][1].limit).toBe(PAGE_LIMIT);
  });
});
