/**
 * Stand-in for `$lib/server/api` in the table-cell overflow harness
 * (portal#1962 slice 4). The real module reads `$env/dynamic/private`, which
 * has no implementation outside a running SvelteKit server, and builds a
 * GraphQLClient pointed at a real hadron-server. This harness mounts real
 * PAGES, and a page's data comes from its real loader — so the loader needs a
 * gqlClient whose every request is answered by the page's own canned map,
 * installed as `globalThis.__fixtureGql` before the loader is imported
 * (the browser-harness equivalent of the client lane's
 * `vi.mock('$lib/server/api', …)`).
 *
 * The stub answers NOTHING on its own: without a canned map installed it is a
 * loud failure, not a silent empty list.
 */
export function serverBaseUrl(): string {
  return 'http://fixture.invalid';
}

export function gqlClient(): { request: (doc: string, vars?: Record<string, unknown>) => Promise<unknown> } {
  const fn = (globalThis as {
    __fixtureGql?: (doc: string, vars?: Record<string, unknown>) => Promise<unknown>;
  }).__fixtureGql;
  if (typeof fn !== 'function') {
    throw new Error('server-api stub: no __fixtureGql canned map installed for this fixture leg');
  }
  return { request: (doc, vars) => fn(doc, vars) };
}
