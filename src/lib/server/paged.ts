/**
 * portal#1615 — follow a paged list to its end (hrn:node:hadronmemory.com:specs:cor:api:120:04).
 *
 * The four API-key lists decide things (a truncated key inventory hides a live
 * key from revocation), so a consumer must follow the pages to the end rather
 * than show page one as the whole list. The page size is PAGE_SIZE (20, the
 * spec's default for a client whose user asked for no more) and is never raised
 * to save round trips.
 *
 * A page read that throws propagates: the caller shows its usual error state,
 * never the pages read so far as if they were the list. An answer that cannot
 * make progress (hasMore with no items, or no new item) throws rather than
 * loops, and MAX_PAGES bounds a server that keeps saying hasMore.
 *
 * Offset paging over a list that changes is not stable: a key revoked or hidden
 * on a page already read shifts every later row up by one, and the next page
 * silently skips a live key (hrn:node:hadronmemory.com:specs:cor:api:120:04
 * gives no cursor). So a read counts as complete only when every page reported
 * the same `total` AND the rows collected equal that total; otherwise it starts
 * over, at most MAX_RESTARTS times, and then fails like any refused read. A
 * created key shifts rows the other way (a duplicate, kept once by id) and is
 * caught by the same count. A revoke plus a create leaves the total alone, so a
 * multi-page read also re-reads page one at the end and starts over if it moved.
 * Not detectable with offsets: one key leaving the middle while another joins
 * the middle between two page reads (a hidden key un-hidden, say) with the
 * total and page one unchanged; the list is then a snapshot a moment stale.
 */
export const PAGE_SIZE = 20;
export const MAX_PAGES = 500;
export const MAX_RESTARTS = 3;

export type PageEnvelope<T> = { items: T[]; total: number; hasMore: boolean };

export class PagingError extends Error {}

/** One pass; `null` when the list moved under it (total changed, or the rows collected are not the total). */
async function readOnce<T extends { id: string }>(
  readPage: (limit: number, offset: number) => Promise<PageEnvelope<T>>,
): Promise<T[] | null> {
  const out: T[] = [];
  const seen = new Set<string>();
  let total: number | null = null;
  let first: string | null = null;
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await readPage(PAGE_SIZE, out.length);
    if (total !== null && page.total !== total) return null;
    total = page.total;
    first ??= page.items.map((i) => i.id).join('\0');
    let added = 0;
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      added += 1;
    }
    if (!page.hasMore) {
      if (out.length !== total) return null;
      // A revoke plus a create leaves the total alone but moves the first page
      // (newest first). A single-page read is one atomic answer; skip the check.
      if (pages === 0) return out;
      const again = await readPage(PAGE_SIZE, 0);
      return again.items.map((i) => i.id).join('\0') === first ? out : null;
    }
    if (added === 0) throw new PagingError('page made no progress');
  }
  throw new PagingError('too many pages');
}

export async function readAllPages<T extends { id: string }>(
  readPage: (limit: number, offset: number) => Promise<PageEnvelope<T>>,
): Promise<T[]> {
  for (let attempt = 0; attempt <= MAX_RESTARTS; attempt += 1) {
    const got = await readOnce(readPage);
    if (got) return got;
  }
  throw new PagingError('list kept changing while it was read');
}
