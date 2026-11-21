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

const CHUNK_SIZE = 200;

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
    // #1412: ask only for this node's missing edge endpoints, never scan the
    // whole memory. A sparse batch is complete; later batches still need reading.
    const ids = [...wanted];
    for (let start = 0; start < ids.length; start += CHUNK_SIZE) {
      const edgeIds = ids.slice(start, start + CHUNK_SIZE);
      const r = await client.request<{ recoveryEdges?: { items: RecoveryEdge[]; total: number } | null }>(
        RECOVERY_EDGES_QUERY, { memoryRef, edgeIds, limit: edgeIds.length },
      );
      const items = r?.recoveryEdges?.items;
      if (!items) return {};
      for (const item of items) {
        if (!wanted.has(item.id)) continue;
        const source = pick(item.source);
        const target = pick(item.target);
        if (source || target) found[item.id] = { ...(source ? { source } : {}), ...(target ? { target } : {}) };
      }
    }
  } catch {
    return {};
  }
  return found;
}
