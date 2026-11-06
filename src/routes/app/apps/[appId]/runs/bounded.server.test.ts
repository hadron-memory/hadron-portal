import { beforeEach, it, expect, vi } from 'vitest';
import { APP_RUNS_QUERY, AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
beforeEach(() => request.mockReset().mockImplementation(async (q: string) => q === APP_RUNS_QUERY ? { appRuns: { items: [], total: 100 } } : q === AGENT_TASKS_APP_QUERY ? { app: { id: 'a', name: 'App' } } : { appNodes: [], app: { id: 'a' } }));
it('uses the whole-set server sort and omits empty statuses at page20', async () => {
  const { load } = await import('./+page.server');
  await load({ params: { appId: 'a' }, locals: { token: 't' }, url: new URL('https://test/app/apps/a/runs?page=3&sort=startedAt&dir=asc&status=FAILED,TIMED_OUT') } as never);
  expect(request).toHaveBeenCalledWith(APP_RUNS_QUERY, { appRef: 'a', statuses: ['FAILED', 'TIMED_OUT'], sortBy: 'startedAt', sortDir: 'asc', limit: 20, offset: 40 });
});
it('never sends invalid enums or an empty statuses array', async () => {
  const { load } = await import('./+page.server');
  await load({ params: { appId: 'a' }, locals: { token: 't' }, url: new URL('https://test/app/apps/a/runs?sort=duration&dir=garbage&status=bad') } as never);
  expect(request).toHaveBeenCalledWith(APP_RUNS_QUERY, { appRef: 'a', sortBy: 'createdAt', sortDir: 'desc', limit: 20, offset: 0 });
});
