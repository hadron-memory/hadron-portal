/**
 * Stand-in for `$app/environment` in the client test lane (#668).
 *
 * Aliased in `vitest.config.ts`'s `client` project rather than mocked per-test,
 * for the reason the sibling `app-navigation` stub gives: the module has no
 * implementation outside a running SvelteKit app. A per-test `vi.mock` is not
 * even an option here — Vite fails to RESOLVE the import while transforming
 * `sveltekit-superforms`, which happens before any mock is installed, so the
 * suite dies at import with a resolver error rather than a missing module.
 *
 * `browser: true` because this lane's whole purpose is the mounted, in-DOM
 * half of a component. A stub reporting `false` would put component code on
 * its server branch inside a jsdom test — the false green this lane exists to
 * remove.
 */
export const browser = true;
export const dev = false;
export const building = false;
export const version = 'test';
