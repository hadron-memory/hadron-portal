import { describe, expect, it, vi } from 'vitest';

const loadTasksApp = vi.fn();
const loadTeamMetrics = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({}) }));
vi.mock('$lib/server/agent-tasks', () => ({ loadTasksApp: (...a: unknown[]) => loadTasksApp(...a) }));
vi.mock('$lib/server/team-metrics', async (orig) => ({
  ...(await orig<typeof import('$lib/server/team-metrics')>()),
  loadTeamMetrics: (...a: unknown[]) => loadTeamMetrics(...a),
}));

import { load } from './+page.server';

const run = (qs: string) =>
  (load as unknown as (e: unknown) => Promise<{ view: { kind: string; metrics?: unknown } }>)({
    params: { appId: 'app1' }, locals: { token: 't' }, url: new URL(`http://x/app/apps/app1/metrics${qs}`),
  });

describe('metrics page load: a malformed day (#2535)', () => {
  it('with an ok base read keeps the snapshot and shows the input error', async () => {
    loadTasksApp.mockResolvedValue({ id: 'app1' });
    loadTeamMetrics.mockResolvedValue({ kind: 'ok', metrics: { appId: 'app1' } });
    const { view } = await run('?since=yesterday');
    expect(view).toEqual({ kind: 'invalid', metrics: { appId: 'app1' } });
    // the malformed day is never sent: the one read is window-less
    expect(loadTeamMetrics).toHaveBeenLastCalledWith(expect.anything(), 'app1');
  });

  it.each([['failed'], ['hidden']])('with a %s base read shows that state, not an input error over nothing', async (kind) => {
    loadTasksApp.mockResolvedValue({ id: 'app1' });
    loadTeamMetrics.mockResolvedValue({ kind });
    const { view } = await run('?until=2026-13-45');
    expect(view).toEqual({ kind });
  });
});
