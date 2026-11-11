import { beforeEach, it, expect, vi } from 'vitest';
import { APP_RUNS_QUERY, AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
beforeEach(() => { request.mockReset().mockImplementation(async (q: string) => q === APP_RUNS_QUERY ? { appRuns: { items: [], total: 100 } } : q === AGENT_TASKS_APP_QUERY ? { app: { id: 'a', name: 'App' } } : { appNodesPage: { items: [], total: 0, hasMore: false }, app: { id: 'a' } }); });
it('uses the whole-set server sort and omits empty statuses at page20', async () => {
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  const load = async (event: { url: URL }) => loadAppRunsPage({ request } as never, 'a', event.url.searchParams);
  await load({ url: new URL('https://test/app/apps/a/runs?page=3&sort=startedAt&dir=asc&status=FAILED,TIMED_OUT') });
  expect(request).toHaveBeenCalledWith(APP_RUNS_QUERY, { appRef: 'a', statuses: ['FAILED', 'TIMED_OUT'], sortBy: 'startedAt', sortDir: 'asc', limit: 20, offset: 40 });
});
it('never sends invalid enums or an empty statuses array', async () => {
  const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
  const load = async (event: { url: URL }) => loadAppRunsPage({ request } as never, 'a', event.url.searchParams);
  await load({ url: new URL('https://test/app/apps/a/runs?sort=duration&dir=garbage&status=bad') });
  expect(request).toHaveBeenCalledWith(APP_RUNS_QUERY, { appRef: 'a', sortBy: 'createdAt', sortDir: 'desc', limit: 20, offset: 0 });
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
it('does not turn a legacy failed POST render into a method-preserving redirect/replay', async () => {
  const { load } = await import('./+page.server');
  const data = await load({ params: { appId: 'a' }, locals: { token: 't' }, request: new Request('https://test/app/apps/a/runs?/run', { method: 'POST' }), url: new URL('https://test/app/apps/a/runs?/run') } as never);
  expect(data).toHaveProperty('legacyPanel');
  expect(request.mock.calls.some(c => c[0] === APP_RUNS_QUERY)).toBe(true);
});
