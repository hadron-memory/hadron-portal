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


// Fewer characters than this ask nothing; a keystroke burst asks once.
export const TYPEAHEAD_MIN_CHARS = 2;
export const TYPEAHEAD_DEBOUNCE_MS = 200;

/**
 * One typeahead round for an edit-mode picker, as the body of a `$effect`
 * (#1438 BLIND P3: this logic used to live inline in the effects, untested).
 * Returns the effect's cleanup. Cleaning up (the next keystroke or teardown)
 * cancels a pending search and discards a late answer, so a slow reply for
 * "au" can never overwrite the hits for "auth". `skip` lets a picker bypass the
 * search for input it does not need suggestions for (a fully-qualified URN).
 * The picker's own node is never suggested.
 */
export function scheduleTypeahead(opts: {
  query: string;
  memoryId: string;
  selfId: string;
  onHits: (hits: TypeaheadNode[]) => void;
  skip?: (q: string) => boolean;
  search?: (memoryId: string, q: string) => Promise<TypeaheadNode[]>;
}): () => void {
  const q = opts.query.trim();
  if (q.length < TYPEAHEAD_MIN_CHARS || opts.skip?.(q)) {
    opts.onHits([]);
    return () => {};
  }
  const search = opts.search ?? searchMemoryNodes;
  let stale = false;
  const timer = setTimeout(async () => {
    const hits = await search(opts.memoryId, q);
    if (!stale) opts.onHits(hits.filter((n) => n.id !== opts.selfId));
  }, TYPEAHEAD_DEBOUNCE_MS);
  return () => {
    stale = true;
    clearTimeout(timer);
  };
}

/**
 * Datalist options for a target that takes a node URN. A hit whose URN cannot
 * be composed (a malformed memory URN) is offered as its bare loc, the same
 * fallback as a memory with no URN, instead of throwing out of the `$derived`
 * that renders the list (#1438 BLIND P3).
 */
export function targetUrnOptions(
  hits: TypeaheadNode[],
  memoryUrn: string | null | undefined,
  compose: (memoryUrn: string, loc: string) => string,
): Array<{ urn: string; name: string }> {
  return hits.map((n) => {
    let urn = n.loc;
    if (memoryUrn) {
      try {
        urn = compose(memoryUrn, n.loc);
      } catch {
        urn = n.loc;
      }
    }
    return { urn, name: n.name ?? n.loc };
  });
}
