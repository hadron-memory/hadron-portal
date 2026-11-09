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
  url: URL, key: string, tab: 'worklog' | 'ai-configs', offset: number, count: number, total: number,
): ListPageNavigation {
  function href(next: number) {
    const params = new URLSearchParams(url.searchParams);
    params.set('tab', tab);
    if (next === 0) params.delete(key); else params.set(key, String(next));
    return `${url.pathname}?${params}`;
  }
  // Advance by the page actually served, not the requested size. A short page
  // with a larger total is not the end (hrn:node:hadronmemory.com:specs:cor:api:120:04).
  const next = offset + count;
  return {
    offset, count, total: count > 0 ? Math.max(total, offset + count) : total,
    firstHref: offset > 0 ? href(0) : null,
    previousHref: offset > 0 ? href(Math.max(0, offset - (count || APP_DISPLAY_PAGE_SIZE))) : null,
    nextHref: count > 0 && (next < total || count === APP_DISPLAY_PAGE_SIZE) && next <= MAX_OFFSET ? href(next) : null,
  };
}
