/**
 * portal#1615 — follow a paged list to its end (cor:api:120:04).
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
 */
export const PAGE_SIZE = 20;
export const MAX_PAGES = 500;

export type PageEnvelope<T> = { items: T[]; total: number; hasMore: boolean };

export class PagingError extends Error {}

export async function readAllPages<T extends { id: string }>(
  readPage: (limit: number, offset: number) => Promise<PageEnvelope<T>>,
): Promise<T[]> {
  const out: T[] = [];
  const seen = new Set<string>();
  for (let pages = 0; pages < MAX_PAGES; pages += 1) {
    const page = await readPage(PAGE_SIZE, out.length);
    // Keys created while the loop runs can shift a page; the id keeps a row once.
    let added = 0;
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
      added += 1;
    }
    if (!page.hasMore) return out;
    if (added === 0) throw new PagingError('page made no progress');
  }
  throw new PagingError('too many pages');
}
