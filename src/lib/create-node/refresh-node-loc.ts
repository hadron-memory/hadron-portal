import { deriveDefaultLoc } from './derive-default-loc';

/** On-demand complete sibling read, using the existing token-scoped paged
 * endpoint. A failed/partial read never changes the draft. Concurrent moves
 * can still race this suggestion; Save's existing move refusal is final.
 *
 * #1989: the suggestion can also land on a soft-deleted sibling's loc. The
 * children read treats a tombstone as not-found for every caller (a normal
 * read, hrn:node:hadronmemory.com:specs:cor:dmo:010:04), yet a tombstone still
 * occupies its loc (hrn:node:hadronmemory.com:specs:cor:api:190:01). That is
 * accepted: Save's refusal is final and the page shows it, rather than reading
 * tombstones here, which the children read must not return. */
export async function refreshedNodeLoc(
  memoryId: string, nodeId: string, savedLoc: string, name: string,
  signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<string> {
  const parent = savedLoc.includes(':') ? savedLoc.slice(0, savedLoc.lastIndexOf(':')) : '';
  const prefix = parent ? `${parent}:` : '';
  const locs = new Set<string>();
  let offset = 0;
  for (;;) {
    signal.throwIfAborted();
    const query = new URLSearchParams({ parent, offset: String(offset) });
    const response = await fetcher(`/app/memories/${encodeURIComponent(memoryId)}/nodes/children?${query}`, {
      signal, cache: 'no-store', headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error('Sibling read failed');
    const page = await response.json();
    if (page?.failed || !Array.isArray(page?.rows) || typeof page.hasMore !== 'boolean' ||
      page.rows.some((row: { id?: unknown; loc?: unknown } | null) => !row || typeof row.id !== 'string' || typeof row.loc !== 'string' ||
        row.loc.slice(0, row.loc.lastIndexOf(':') + 1) !== prefix)) throw new Error('Invalid sibling page');
    for (const row of page.rows) if (row.id !== nodeId) locs.add(row.loc);
    if (!page.hasMore) break;
    if (page.rows.length === 0) throw new Error('Sibling read made no progress');
    offset += page.rows.length;
  }
  signal.throwIfAborted();
  const next = prefix + deriveDefaultLoc(name, parent, [...locs]);
  if (locs.has(next)) throw new Error('No available suggestion');
  return next;
}
