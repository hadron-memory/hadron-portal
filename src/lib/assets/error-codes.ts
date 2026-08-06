/**
 * Asset error codes both sides need to recognise.
 *
 * Shared rather than duplicated because these strings are load-bearing on the
 * CLIENT too — the attach dialog retries on a loc conflict — while the mapping
 * to HTTP status lives server-side in $lib/server/assetErrors.ts, which a
 * `.svelte` component cannot import.
 */

/**
 * A node already occupies the target loc.
 *
 * Reference-node writes go through hadron-server's `writeNodeCore` in 'create'
 * mode, which throws typed errors whose `extensions.code` is the CLASS NAME
 * (`NodeLocConflictError`) — NOT a SCREAMING_CASE constant like every other code
 * on this surface. Guessing `LOC_CONFLICT` matches nothing, which is silent: the
 * mapper falls through to a 500 and the client sees "the server had a problem"
 * instead of an actionable conflict.
 */
export const LOC_CONFLICT_CODE = 'NodeLocConflictError';
