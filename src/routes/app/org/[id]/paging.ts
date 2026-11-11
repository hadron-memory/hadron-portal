export const PUBLIC_ORG_DEFAULT_LIMIT = 20;
export const PUBLIC_ORG_MAX_LIMIT = 200;
const INT32_MAX = 2147483647;

export type PublicOrgResourceKind = 'memories' | 'agents';

function positiveInt(raw: string | null): number | null {
  if (raw === null || !/^[0-9]+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= INT32_MAX ? value : null;
}

/** Default 20. Positive URL limits are user requests; the server caps at 200. */
export function parsePublicOrgLimit(raw: string | null): number {
  const value = positiveInt(raw);
  return value !== null && value > 0 ? value : PUBLIC_ORG_DEFAULT_LIMIT;
}

/** Invalid/negative/GraphQL-Int-overflow offsets start at zero; past-end is valid. */
export function parsePublicOrgOffset(raw: string | null): number {
  return positiveInt(raw) ?? 0;
}

/** Never offer a non-advancing Next on empty/count-only data. */
export function nextOffset(offset: number, page: { items: unknown[]; hasMore: boolean }): number | null {
  return page.hasMore && page.items.length > 0 ? offset + page.items.length : null;
}

/**
 * Previous uses the effective request size, never a raw over-cap request or
 * the current page's item count (a final page may be short). The server's
 * same-transaction count + take makes every non-final page exactly this size.
 */
export function previousOffset(offset: number, requestedLimit: number): number | null {
  if (offset <= 0) return null;
  return Math.max(0, offset - Math.min(requestedLimit, PUBLIC_ORG_MAX_LIMIT));
}

/** Native GET state for one kind, preserving the other kind and unrelated params. */
export function pageHref(
  pathname: string,
  search: string,
  kind: PublicOrgResourceKind,
  target: { limit: number; offset: number },
): string {
  const params = new URLSearchParams(search);
  const limitKey = `${kind}Limit`;
  const offsetKey = `${kind}Offset`;
  if (target.limit === PUBLIC_ORG_DEFAULT_LIMIT) params.delete(limitKey);
  else params.set(limitKey, String(target.limit));
  if (target.offset === 0) params.delete(offsetKey);
  else params.set(offsetKey, String(target.offset));
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
