/**
 * The ancestors of one node, for its breadcrumb (portal#1433, D3).
 *
 * The node page used to read these out of the memory layout's whole node list.
 * The layout no longer ships that list, so the ancestors come from one
 * `nodeBatch` over their node URNs: at most one ref per loc segment, issued in
 * parallel with the node read.
 *
 * `nodeBatch` ERRORS over its ref cap (200) rather than truncating, so a loc
 * deeper than that is read in chunks, never in one oversized call.
 */
import type { GraphQLClient } from 'graphql-request';
import { NODE_ANCESTORS_QUERY } from '$lib/server/queries';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';

type Client = Pick<GraphQLClient, 'request'>;

/** hadron-server's BATCH_READ_MAX_NODES: more refs than this is a query error. */
export const NODE_BATCH_MAX_REFS = 200;

export type Ancestor = { id: string; loc: string; name: string | null; nodeType: string; tags: string[] };

/** Every proper ancestor loc of `loc` (`a:b:c` -> `a`, `a:b`), root first. */
export function ancestorLocs(loc: string): string[] {
  const parts = loc.split(':');
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join(':'));
}

/**
 * Resolve each ancestor of `loc` within THIS memory, keyed by loc. A segment
 * with no readable node is simply absent (the crumb keeps its slug). A failed
 * read is logged and degrades the same way: the breadcrumb is navigation
 * chrome, not the page's core load.
 *
 * `known` is true only when EVERY ancestor was asked and every request
 * answered, so an absent segment provably has no node. When it is false an
 * absent segment means "not looked up", and the page must not offer to create
 * it (portal#1524's `ancestorsKnown`).
 */
export async function loadAncestors(
  client: Client,
  memory: { id: string; urn: string | null | undefined },
  loc: string,
): Promise<{ byLoc: Map<string, Ancestor>; known: boolean }> {
  const found = new Map<string, Ancestor>();
  const locs = ancestorLocs(loc);
  if (locs.length === 0) return { byLoc: found, known: true };
  if (!memory.urn) return { byLoc: found, known: false };
  let known = true;
  const refs: string[] = [];
  for (const ancestor of locs) {
    try {
      refs.push(composeNodeUrn(memory.urn, ancestor));
    } catch {
      // An address we cannot compose is an ancestor we cannot look up.
      known = false;
    }
  }
  const chunks: string[][] = [];
  for (let at = 0; at < refs.length; at += NODE_BATCH_MAX_REFS) chunks.push(refs.slice(at, at + NODE_BATCH_MAX_REFS));
  const settled = await Promise.allSettled(
    chunks.map((chunk) =>
      client.request<{
        nodeBatch: { nodes: Array<Ancestor & { memoryId: string }>; truncated?: boolean | null; omitted?: string[] | null };
      }>(
        NODE_ANCESTORS_QUERY,
        { refs: chunk },
      ),
    ),
  );
  for (const result of settled) {
    if (result.status === 'rejected') {
      console.warn('[node-detail] breadcrumb ancestor lookup failed:', result.reason);
      known = false;
      continue;
    }
    const batch = result.value?.nodeBatch;
    // A malformed answer is a failed read, not an empty one.
    if (!batch || !Array.isArray(batch.nodes)) {
      console.warn('[node-detail] breadcrumb ancestor lookup returned no nodeBatch');
      known = false;
      continue;
    }
    // The server fills `omitted` only when `truncated` (hrn:node:hadronmemory.com:specs:cor:api:040); either
    // one means a readable ancestor went unanswered (#1438 BLIND P2).
    if (batch.truncated || (batch.omitted?.length ?? 0) > 0) known = false;
    // Same-memory guard (#234): a ref is memory-qualified, but keep the check
    // load-bearing rather than incidental.
    for (const n of batch.nodes) {
      if (n.memoryId === memory.id) found.set(n.loc, { id: n.id, loc: n.loc, name: n.name ?? null, nodeType: n.nodeType, tags: n.tags ?? [] });
    }
  }
  return { byLoc: found, known };
}
