/**
 * A stand-in for the server's `findNodes` answer to the two loc-scoped reads the
 * node page and the new-node page make, modelled on the producer
 * (hrn:node:hadronmemory.com:hadron-portal:findings:untyped-json-fixtures-must-follow-producer):
 *
 * - `childrenOf` (hadron-server#2832, hrn:node:hadronmemory.com:specs:cor:api:090:02): the nodes whose loc is
 *   exactly `childrenOf` plus one segment; `""` is the top level. With no query
 *   and no sort the order is the sibling order of hrn:node:hadronmemory.com:specs:cor:dmo:020:01, "Order A"
 *   (Holger, Piona 6548016260): positioned nodes first by `seq`, then the rest
 *   by loc. `total` is null on this filter, and nothing says whether more rows
 *   exist.
 * - `locPrefix`: every descendant under the prefix, counted, as the read the
 *   portal used before #1656 got it.
 *
 * `limit` clamps to the server's 1-200 and `offset` skips, as `findNodes` does.
 */
export type FakeChildRow = {
  id: string; loc: string; name?: string | null; seq?: number | null; memoryId?: string;
  nodeType?: string; tags?: string[]; isRunnable?: boolean | null; description?: string | null;
};

export const siblingOrder = (a: FakeChildRow, b: FakeChildRow): number => {
  const as = a.seq ?? null;
  const bs = b.seq ?? null;
  if (as !== null && bs !== null && as !== bs) return as - bs;
  if (as !== null && bs === null) return -1;
  if (as === null && bs !== null) return 1;
  return a.loc < b.loc ? -1 : a.loc > b.loc ? 1 : 0;
};

export function fakeFindNodesChildren(rows: FakeChildRow[], memoryId: string) {
  return (vars: Record<string, unknown> = {}) => {
    const limit = Math.min(200, Math.max(1, Number(vars.limit ?? 20)));
    const offset = Math.max(0, Number(vars.offset ?? 0));
    const inMemory = rows.filter((n) => (n.memoryId ?? memoryId) === ((vars.memoryId as string | undefined) ?? memoryId));
    const hit = (n: FakeChildRow) => ({
      node: {
        id: n.id, loc: n.loc, name: n.name === undefined ? n.loc : n.name, description: n.description ?? null,
        nodeType: n.nodeType ?? 'info', tags: n.tags ?? [], seq: n.seq ?? null, isRunnable: n.isRunnable ?? null,
        memoryId: n.memoryId ?? memoryId, commentSummary: null,
      },
    });
    if (typeof vars.childrenOf === 'string') {
      const parent = vars.childrenOf;
      const direct = inMemory
        .filter((n) => (parent === '' ? !n.loc.includes(':') : n.loc.startsWith(`${parent}:`) && !n.loc.slice(parent.length + 1).includes(':')))
        .sort(siblingOrder);
      return { findNodes: { total: null, hits: direct.slice(offset, offset + limit).map(hit) } };
    }
    const prefix = (vars.locPrefix ?? '') as string;
    const all = inMemory.filter((n) => n.loc.startsWith(prefix)).sort((a, b) => (a.loc < b.loc ? -1 : 1));
    return { findNodes: { total: all.length, hits: all.slice(offset, offset + limit).map(hit) } };
  };
}
