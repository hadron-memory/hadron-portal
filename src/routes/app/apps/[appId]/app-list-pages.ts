import type { ListPageNavigation } from '$lib/list-page';

export const APP_DISPLAY_PAGE_SIZE = 20;
const MAX_OFFSET = 2147483647;

/** Invalid optional URL state falls back to the first page, never an oversized request. */
export function appListOffset(params: URLSearchParams, key: string): number {
  const raw = params.get(key) ?? '0';
  if (!/^\d+$/.test(raw)) return 0;
  const offset = Number(raw);
  return Number.isSafeInteger(offset) && offset <= MAX_OFFSET ? offset : 0;
}

/** Both queries return an ordered { items, total } page; never auto-drain a display list. */
export function appListNavigation(
  url: URL, key: string, tab: 'worklog' | 'ai-configs' | 'memory' | 'runs' | 'chats' | 'history', offset: number, count: number, total: number,
  options: { clearParams?: string[]; hasMore?: boolean } = {},
): ListPageNavigation {
  function href(next: number) {
    const params = new URLSearchParams(url.searchParams);
    params.set('tab', tab);
    for (const key of options.clearParams ?? []) params.delete(key);
    if (next === 0) params.delete(key); else params.set(key, String(next));
    return `${url.pathname}?${params}`;
  }
  // Advance by the page actually served, not the requested size. A short page
  // with a larger total is not the end (hrn:node:hadronmemory.com:specs:cor:api:120:04).
  const next = offset + count;
  return {
    offset, count, total: count > 0 ? Math.max(total, offset + count) : total,
    firstHref: offset > 0 ? href(0) : null,
    // #1868: step BACK by the page size, never by the count served on the
    // current page. Served-count stepping is a Next-side survival trait (it
    // keeps the window glued to the data when counts race); applied to
    // Previous it makes a short last page creep back by its own length
    // (41 records: offset 40 -> 39 -> 37 …), landing on overlapping,
    // misaligned pages and hiding the page the reader came from. The full
    // window before this one always starts at offset - PAGE_SIZE, whatever
    // this page served — or nothing, if this page is empty after deletes.
    previousHref: offset > 0 ? href(Math.max(0, offset - APP_DISPLAY_PAGE_SIZE)) : null,
    // A full page probes forward unless the server explicitly says it is the
    // end. Without hasMore, even total===count can lag a newly arrived row;
    // an exact hasMore=false must not offer an empty page
    // (hrn:node:hadronmemory.com:specs:cor:api:120:04).
    nextHref: count > 0 && (next < total || (count === APP_DISPLAY_PAGE_SIZE && options.hasMore !== false)) && next <= MAX_OFFSET ? href(next) : null,
  };
}
