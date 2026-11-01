import type { MemoryNode } from '$lib/types';

export type TypeaheadNode = Pick<MemoryNode, 'id' | 'loc' | 'name' | 'memoryId'>;

// Hits a typeahead asks for. The endpoint clamps to its own cap (portal#1433).
export const TYPEAHEAD_LIMIT = 20;

// Same-memory node lookup through POST /api/nodes/search, replacing the
// memory-wide graphNodes the node page used to scan. Any failure is an empty
// result: a typeahead degrades to "no suggestions", never to an error. The
// request is scoped to `memoryId` and the answer is re-checked here, so a
// suggestion is never a node of another memory, and never more than
// TYPEAHEAD_LIMIT of them (portal#1433 acceptance 3).
export async function searchMemoryNodes(
  memoryId: string,
  query: string,
  fetchFn: typeof fetch = fetch,
): Promise<TypeaheadNode[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const res = await fetchFn('/api/nodes/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: q, memoryIds: [memoryId], limit: TYPEAHEAD_LIMIT }),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { nodes?: TypeaheadNode[] };
    return (body.nodes ?? [])
      .filter((n): n is TypeaheadNode => !!n && typeof n.loc === 'string' && n.memoryId === memoryId)
      .slice(0, TYPEAHEAD_LIMIT);
  } catch {
    return [];
  }
}

