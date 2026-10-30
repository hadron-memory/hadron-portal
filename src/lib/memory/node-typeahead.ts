import type { MemoryNode } from '$lib/types';

export type TypeaheadNode = Pick<MemoryNode, 'id' | 'loc' | 'name'>;

// Hits a typeahead asks for. The endpoint clamps to its own cap (portal#1433).
export const TYPEAHEAD_LIMIT = 20;

// Same-memory node lookup through POST /api/nodes/search, replacing the
// memory-wide graphNodes the node page used to scan. Any failure is an empty
// result: a typeahead degrades to "no suggestions", never to an error.
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
    return (body.nodes ?? []).filter((n): n is TypeaheadNode => !!n && typeof n.loc === 'string');
  } catch {
    return [];
  }
}

// Exact loc/name match first, then the first hit — the old graphNodes rule.
export function pickEdgeTarget(hits: TypeaheadNode[], query: string): TypeaheadNode | null {
  const q = query.trim().toLowerCase();
  return (
    hits.find((n) => n.loc.toLowerCase() === q || n.name?.toLowerCase() === q) ?? hits[0] ?? null
  );
}
