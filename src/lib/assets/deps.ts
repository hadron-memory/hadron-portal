/**
 * SvelteKit invalidation keys for the asset surfaces.
 *
 * Lives in $lib rather than beside the loader that declares it: `+page.server.ts`
 * is server-only, so a `.svelte` component importing the constant from there is
 * a build error, and duplicating the literal on both sides would let the two
 * drift silently — `invalidate()` with a key no loader declared is a no-op, so
 * the page would simply stop refreshing with nothing to notice.
 */

/**
 * The per-memory Assets tab loader. Scoped deliberately: `invalidateAll()` would
 * also re-run the memory layout, which pages every node and edge in the memory.
 */
export const MEMORY_ASSETS_DEP = 'hadron:memory-assets';
