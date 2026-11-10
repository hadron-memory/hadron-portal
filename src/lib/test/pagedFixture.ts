/** portal#1615 — a server's `{ items, total, hasMore }` answer over `all`, honouring limit and offset like the real page fields (default 20, cap 200). */
export function pageOf<T>(all: readonly T[], vars: { limit?: number | null; offset?: number | null } = {}) {
  const limit = Math.min(Math.max(vars.limit ?? 20, 0), 200);
  const offset = Math.max(vars.offset ?? 0, 0);
  return { items: all.slice(offset, offset + limit), total: all.length, hasMore: offset + limit < all.length };
}
