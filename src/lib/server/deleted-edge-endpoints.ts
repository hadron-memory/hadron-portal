import type { gqlClient } from '$lib/server/api';
import { RECOVERY_EDGES_QUERY } from '$lib/server/queries';

/**
 * #1161 — which endpoints of a node's edges are DELETED, as the server reports
 * it (recoveryEdges, writer-only). A missing endpoint on an edge is ambiguous:
 * it is also what an endpoint in a memory the viewer cannot read looks like, and
 * that must stay masked. So an edge is marked only when the server lists it with
 * a `deletedAt` endpoint; absent from the list, or any read failure, marks nothing.
 */
export interface DeletedEndpoint {
  id: string;
  urn: string;
  loc: string;
  name: string;
}
export type DeletedEdgeEndpoints = Record<string, { source?: DeletedEndpoint; target?: DeletedEndpoint }>;

interface RecoveryEdge {
  id: string;
  source: (DeletedEndpoint & { deletedAt: string | null }) | null;
  target: (DeletedEndpoint & { deletedAt: string | null }) | null;
}

const PAGE = 200;
const MAX_PAGES = 10;

export async function deletedEdgeEndpoints(
  client: ReturnType<typeof gqlClient>,
  memoryRef: string,
  edges: Array<{ id: string; source?: unknown; target?: unknown }>,
): Promise<DeletedEdgeEndpoints> {
  const wanted = new Set(edges.filter((e) => !e.source || !e.target).map((e) => e.id));
  if (wanted.size === 0) return {};
  const found: DeletedEdgeEndpoints = {};
  const pick = (ep: RecoveryEdge['source']): DeletedEndpoint | undefined =>
    ep?.deletedAt ? { id: ep.id, urn: ep.urn, loc: ep.loc, name: ep.name } : undefined;
  try {
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = await client.request<{ recoveryEdges?: { items: RecoveryEdge[]; total: number } | null }>(
        RECOVERY_EDGES_QUERY, { memoryRef, limit: PAGE, offset: page * PAGE },
      );
      const items = r?.recoveryEdges?.items;
      if (!items) return {};
      for (const item of items) {
        if (!wanted.has(item.id)) continue;
        seen.add(item.id);
        const source = pick(item.source);
        const target = pick(item.target);
        if (source || target) found[item.id] = { ...(source ? { source } : {}), ...(target ? { target } : {}) };
      }
      if (items.length < PAGE || seen.size === wanted.size) break;
    }
  } catch {
    return {};
  }
  return found;
}
