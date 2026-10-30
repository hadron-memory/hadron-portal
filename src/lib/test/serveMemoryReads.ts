import { NODE_ANCESTORS_QUERY, NODE_CHILDREN_QUERY } from '$lib/server/queries';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';

/** A node row as the old layout's slim `graphNodes` carried it. */
export type SeedNode = {
  id: string;
  loc: string;
  name?: string | null;
  memoryId?: string;
  nodeType?: string;
  tags?: string[];
  seq?: number | null;
  isRunnable?: boolean | null;
  description?: string | null;
};

/**
 * A stand-in for the server reads that replaced `graphNodes` (portal#1433):
 * the breadcrumb/chat-root `nodeBatch`, the children/sibling `findNodes
 * childrenOf`, and the aliased wikilink lookups. Returns undefined for any
 * document it does not own, so a test chains its own handler after it.
 */
export function serveMemoryReads(
  rows: SeedNode[],
  memory: { id: string; urn: string },
  // A URN names its memory, so the real server never answers a lookup for this
  // memory's URN with another memory's node. `leakForeign` lets a test stage the
  // misbehaving server to prove the portal's own memory guard still holds.
  opts: { leakForeign?: boolean } = {},
) {
  const full = (n: SeedNode) => ({
    id: n.id,
    memoryId: n.memoryId ?? memory.id,
    loc: n.loc,
    name: n.name ?? n.loc,
    nodeType: n.nodeType ?? 'info',
    tags: n.tags ?? [],
    seq: n.seq ?? null,
    isRunnable: n.isRunnable ?? null,
    description: n.description ?? null,
  });
  const byUrn = new Map<string, SeedNode>();
  for (const n of rows) {
    if (!opts.leakForeign && (n.memoryId ?? memory.id) !== memory.id) continue;
    try {
      byUrn.set(composeNodeUrn(memory.urn, n.loc), n);
    } catch {
      // A memory URN that cannot qualify a loc addresses nothing.
    }
  }
  return (doc: string, vars: Record<string, unknown> = {}): unknown => {
    if (doc === NODE_ANCESTORS_QUERY) {
      const refs = (vars.refs ?? []) as string[];
      const nodes = refs.flatMap((r) => (byUrn.has(r) ? [full(byUrn.get(r)!)] : []));
      return { nodeBatch: { nodes, unavailable: [], omitted: 0, truncated: false } };
    }
    if (doc === NODE_CHILDREN_QUERY) {
      if ((vars.offset ?? 0) !== 0) return { findNodes: { hits: [] } };
      const parent = (vars.childrenOf ?? '') as string;
      const ids = (vars.memoryIds ?? [memory.id]) as string[];
      const hits = rows
        .filter((n) => ids.includes(n.memoryId ?? memory.id))
        .filter((n) => {
          if (parent === '') return !n.loc.includes(':');
          return n.loc.startsWith(`${parent}:`) && !n.loc.slice(parent.length + 1).includes(':');
        })
        .map((n) => ({ node: { ...full(n), commentSummary: null } }));
      return { findNodes: { hits } };
    }
    // The aliased wikilink lookup: `w{i}` is the node at URN `r{i}`, or null.
    if (doc.startsWith('query WikilinkTargets')) {
      return Object.fromEntries(
        Object.keys(vars).map((k, i) => {
          const hit = byUrn.get(vars[k] as string);
          return [`w${i}`, hit ? { id: hit.id, name: hit.name ?? null, memoryId: hit.memoryId ?? memory.id } : null];
        }),
      );
    }
    return undefined;
  };
}
