import { beforeEach, it, expect, vi } from 'vitest';
import { APP_RUNS_QUERY, AGENT_TASKS_APP_QUERY, APP_NODES_QUERY } from '$lib/server/queries';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
beforeEach(() => { request.mockReset().mockImplementation(async (q: string) => q === APP_RUNS_QUERY ? { appRuns: { items: [], total: 100 } } : q === AGENT_TASKS_APP_QUERY ? { app: { id: 'a', name: 'App' } } : q === APP_NODES_QUERY ? { appNodes: [] } : { appNodesPage: { items: [], total: 0, hasMore: false }, app: { id: 'a' } }); });
it('uses the whole-set server sort and omits empty statuses at page20', async () => {
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  const load = async (event: { url: URL }) => loadAppRunsPage({ request } as never, 'a', event.url.searchParams);
  await load({ url: new URL('https://test/app/apps/a/runs?page=3&sort=startedAt&dir=asc&status=FAILED,TIMED_OUT') });
  expect(request).toHaveBeenCalledWith(APP_RUNS_QUERY, { appRef: 'a', statuses: ['FAILED', 'TIMED_OUT'], sortBy: 'startedAt', sortDir: 'asc', limit: 20, offset: 40 });
});
it('never sends invalid enums or an empty statuses array', async () => {
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  const load = async (event: { url: URL }) => loadAppRunsPage({ request } as never, 'a', event.url.searchParams);
  await load({ url: new URL('https://test/app/apps/a/runs?sort=bogus&dir=garbage&status=bad') });
  expect(request).toHaveBeenCalledWith(APP_RUNS_QUERY, { appRef: 'a', sortBy: 'createdAt', sortDir: 'desc', limit: 20, offset: 0 });
});
it('sends the Duration sort to the server in both directions (portal#1499)', async () => {
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  for (const dir of ['asc', 'desc'] as const) {
    request.mockClear();
    await loadAppRunsPage({ request } as never, 'a', new URLSearchParams(`sort=duration&dir=${dir}`));
    expect(request).toHaveBeenCalledWith(APP_RUNS_QUERY, { appRef: 'a', sortBy: 'duration', sortDir: dir, limit: 20, offset: 0 });
  }
});
it('clamps an out-of-range page using the server total and reads that last page', async () => {
  request.mockImplementation(async q => q === APP_RUNS_QUERY ? { appRuns: { items: [], total: 21 } } : { app: { id: 'a' } });
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  const page = await loadAppRunsPage({ request } as never, 'a', new URLSearchParams('page=99'));
  expect(request.mock.calls.filter(c => c[0] === APP_RUNS_QUERY).map(c => c[1].offset)).toEqual([1960, 20]);
  expect(page).toMatchObject({ page: 2, total: 21, failed: false });
});
it('keeps real empty success distinct from a failed runs read', async () => {
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  request.mockImplementation(async q => q === APP_RUNS_QUERY ? { appRuns: { items: [], total: 0 } } : { app: { id: 'a' } });
  expect(await loadAppRunsPage({ request } as never, 'a', new URLSearchParams())).toMatchObject({ failed: false, total: 0 });
  request.mockImplementation(async q => { if (q === APP_RUNS_QUERY) throw new Error('transport'); return { app: { id: 'a' } }; });
  expect(await loadAppRunsPage({ request } as never, 'a', new URLSearchParams())).toMatchObject({ failed: true, total: 0 });
});
// portal#1767 row 5 (`shape`): the loader's isRunsSection guard. Mutant: no-op
// the throw — each malformed reply below would then be served as an empty or
// garbage SUCCESS; the pin holds the failed shape instead. Every reply is
// answered, so the pin never dies on an unanswered mock. Each case violates
// EXACTLY ONE rule (blind P3 on #1767: the old non-enum row also carried a
// malformed createdAt, so a guard checking only createdAt passed it), and
// it.each names the failing reply instead of dying anonymously in a loop.
const malformedReplies = [
  ['missing items', { appRuns: { total: 0 } }],
  ['a row with a non-enum status', { appRuns: { items: [{ id: 'bad', status: 42, triggerKind: 'MANUAL', entryNodeUrn: 'urn', createdAt: '2026-10-01T10:00:00.000Z' }], total: 1 } }],
  ['negative total', { appRuns: { items: [], total: -5 } }],
] as const;
it.each(malformedReplies)('serves a malformed appRuns reply as a failed page, never an empty success: %s (row 5: no-op the shape guard)', async (_label, reply) => {
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  request.mockImplementation(async q => q === APP_RUNS_QUERY ? reply : { app: { id: 'a' } });
  await expect(loadAppRunsPage({ request } as never, 'a', new URLSearchParams())).resolves.toMatchObject({ failed: true, runs: [], total: 0 });
});
it('retains App concealment before issuing any runs read', async () => {
  request.mockResolvedValue({ app: null });
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  await expect(loadAppRunsPage({ request } as never, 'foreign', new URLSearchParams())).rejects.toMatchObject({ status: 404 });
  expect(request.mock.calls.some(c => c[0] === APP_RUNS_QUERY)).toBe(false);
});
it('both legacy paths redirect once with the query intact and Runs selected', async () => {
  const canonical = await import('./+page.server');
  const nested = await import('../../../orgs/[id]/apps/[appId]/runs/+page.server');
  const event = { params: { appId: 'a' }, url: new URL('https://test/app/apps/a/runs?status=FAILED&page=3&sort=status&dir=asc&extra=keep'), parent: async () => ({}) };
  await expect(canonical.load(event as never)).rejects.toMatchObject({ status: 308, location: '/app/apps/a?status=FAILED&page=3&sort=status&dir=asc&extra=keep&tab=runs' });
  await expect(nested.load(event as never)).rejects.toMatchObject({ status: 308, location: '/app/apps/a?status=FAILED&page=3&sort=status&dir=asc&extra=keep&tab=runs' });
});
// portal#1767 rows 8-9 (`enc_l`, `enc_n`): both legacy 308s encode the appId
// into the redirect path. Mutant: interpolate params.appId raw — the reserved
// `?` then folds the rest of the id into the query and the location stops
// being the encoded form, so the pin dies on the assertion below.
it('encodes a reserved-character appId in both legacy redirects and stays under /app/apps/ (rows 8-9: raw appId)', async () => {
  const canonical = await import('./+page.server');
  const nested = await import('../../../orgs/[id]/apps/[appId]/runs/+page.server');
  const event = { params: { id: 'org-1', appId: 'a/b?x' }, url: new URL('https://test/app/apps/a%2Fb%3Fx/runs?page=3'), parent: async () => ({}) };
  for (const route of [canonical.load, nested.load]) {
    await expect(route(event as never)).rejects.toMatchObject({ status: 308, location: '/app/apps/a%2Fb%3Fx?page=3&tab=runs' });
  }
});
it('does not turn a legacy failed POST render into a method-preserving redirect/replay', async () => {
  const { load } = await import('./+page.server');
  const data = await load({ params: { appId: 'a' }, locals: { token: 't' }, request: new Request('https://test/app/apps/a/runs?/run', { method: 'POST' }), url: new URL('https://test/app/apps/a/runs?/run') } as never);
  expect(data).toHaveProperty('legacyPanel');
  expect(request.mock.calls.some(c => c[0] === APP_RUNS_QUERY)).toBe(true);
});
