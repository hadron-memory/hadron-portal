/**
 * Direct children (or the roots) of one loc, read from the server (portal#1433,
 * hadron-server#2832) instead of filtering the memory-wide node list.
 */
import { NODE_CHILDREN_QUERY } from '$lib/server/queries';
import { drainFindNodes } from '$lib/server/paginate';
import type { MemoryNode } from '$lib/types';
import type { GraphQLClient } from 'graphql-request';

type ChildHit = {
  node: {
    id: string;
    memoryId: string;
    loc: string;
    name: string;
    nodeType: string;
    tags: string[];
    seq: number | null;
    isRunnable: boolean | null;
    description: string | null;
    commentSummary?: { openThreads: number } | null;
  };
};

const EPOCH_ISO = new Date(0).toISOString();

/** Order A: `seq` ascending with null last, then `loc`. The server applies it; the
 * loader re-asserts it so a server that drifts cannot reorder the tab silently. */
export function orderChildren<T extends { seq: number | null; loc: string }>(nodes: T[]): T[] {
  return [...nodes].sort((a, b) => {
    if (a.seq !== null && b.seq !== null) return a.seq - b.seq;
    if (a.seq !== null) return -1;
    if (b.seq !== null) return 1;
    return a.loc.localeCompare(b.loc);
  });
}

/** `parentLoc` '' reads the roots. Throws on a failed read; callers turn that into `childrenFailed`. */
export async function loadChildren(
  client: GraphQLClient,
  memory: { id: string; urn?: string | null; name?: string | null },
  parentLoc: string,
): Promise<MemoryNode[]> {
  const { findNodes } = await drainFindNodes<ChildHit>(client, NODE_CHILDREN_QUERY, {
    memoryIds: [memory.id],
    childrenOf: parentLoc,
  });
  const memRef = { id: memory.id, urn: memory.urn ?? null, name: memory.name ?? '' } as MemoryNode['memory'];
  const rows: MemoryNode[] = findNodes.hits.map(({ node: n }) => ({
    id: n.id,
    memoryId: n.memoryId ?? memory.id,
    nodeType: n.nodeType,
    loc: n.loc,
    name: n.name,
    alias: null,
    description: n.description ?? null,
    abstract: null,
    content: null,
    tokens: null,
    tags: n.tags,
    seq: n.seq ?? null,
    data: null,
    ownerRepo: null,
    isRunnable: n.isRunnable ?? null,
    openThreads: n.commentSummary?.openThreads ?? 0,
    createdAt: EPOCH_ISO,
    updatedAt: EPOCH_ISO,
    memory: memRef,
    outgoingEdges: [],
    incomingEdges: [],
  }));
  return orderChildren(rows);
}
