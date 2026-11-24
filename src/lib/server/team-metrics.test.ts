import { describe, expect, it, vi } from 'vitest';
import { loadTeamMetrics, windowFromParams } from './team-metrics';

const count = (total: number, truncated = false) => {
  const ids = ['a', 'b'].slice(0, total);
  return { total, ids, truncated, named: ids.map((id) => ({ id, name: null })) };
};
const full = {
  appId: 'app1', asOf: '2026-11-22T10:00:00Z', window: { since: '2026-11-15T10:00:00Z', until: '2026-11-22T10:00:00Z' },
  startedOwned: { all: count(2), ownersTruncated: false, byOwner: [] },
  projects: { truncated: false, items: [] },
  workers: { active: count(1), idle: count(0), overdue: count(0), inop: count(0) },
  flow: { completed: count(1), started: count(2) },
};
const refused = (code: string) => ({ response: { errors: [{ message: 'x', extensions: { code } }] } });
const clientOf = (impl: () => Promise<unknown>) => ({ request: vi.fn(impl) }) as never;

describe('loadTeamMetrics', () => {
  it('returns the server answer untouched', async () => {
    const view = await loadTeamMetrics(clientOf(async () => ({ teamMetrics: full })), 'app1');
    expect(view).toEqual({ kind: 'ok', metrics: full });
  });

  it('keeps null task reports null for a roster-only reader, and still returns the workers', async () => {
    const partial = { ...full, startedOwned: null, projects: null, flow: null };
    const view = await loadTeamMetrics(clientOf(async () => ({ teamMetrics: partial })), 'app1');
    expect(view.kind).toBe('ok');
    if (view.kind === 'ok') {
      expect(view.metrics.startedOwned).toBeNull();
      expect(view.metrics.projects).toBeNull();
      expect(view.metrics.flow).toBeNull();
      expect(view.metrics.workers.active.total).toBe(1);
    }
  });

  it('passes no window when none was chosen: the default is the server\'s', async () => {
    const client = clientOf(async () => ({ teamMetrics: full }));
    await loadTeamMetrics(client, 'app1');
    expect((client as unknown as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0]![1]).toEqual({ appRef: 'app1' });
  });

  it('passes a chosen window through', async () => {
    const client = clientOf(async () => ({ teamMetrics: full }));
    await loadTeamMetrics(client, 'app1', { since: '2026-11-01T00:00:00.000Z', until: '2026-11-08T00:00:00.000Z' });
    expect((client as unknown as { request: ReturnType<typeof vi.fn> }).request.mock.calls[0]![1]).toEqual({
      appRef: 'app1', since: '2026-11-01T00:00:00.000Z', until: '2026-11-08T00:00:00.000Z',
    });
  });

  it.each(['APP_NOT_FOUND', 'FORBIDDEN', 'NOT_FOUND'])('%s is one hidden answer, never an empty dashboard', async (code) => {
    expect(await loadTeamMetrics(clientOf(() => Promise.reject(refused(code))), 'app1')).toEqual({ kind: 'hidden' });
  });

  it('BAD_USER_INPUT is an input error, not a refusal, and keeps the rest of the page via a window-less read', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(refused('BAD_USER_INPUT'))
      .mockResolvedValueOnce({ teamMetrics: full });
    const view = await loadTeamMetrics({ request } as never, 'app1', { since: '2026-01-01T00:00:00.000Z', until: '2026-06-01T00:00:00.000Z' });
    expect(view).toEqual({ kind: 'invalid', metrics: full });
    expect(request.mock.calls[1]![1]).toEqual({ appRef: 'app1' });
  });

  it('does not retry when no window was sent', async () => {
    const request = vi.fn().mockRejectedValue(refused('BAD_USER_INPUT'));
    expect(await loadTeamMetrics({ request } as never, 'app1')).toEqual({ kind: 'invalid', metrics: null });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('a refused window whose fallback read also fails is invalid with no metrics', async () => {
    // A window is sent, so the refusal reaches the fallback; the fallback is refused too (#2535).
    const request = vi.fn().mockRejectedValue(refused('BAD_USER_INPUT'));
    const view = await loadTeamMetrics({ request } as never, 'app1', { since: '2026-01-01T00:00:00.000Z', until: '2026-06-01T00:00:00.000Z' });
    expect(view).toEqual({ kind: 'invalid', metrics: null });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each([['an outage', new Error('boom'), 'failed'], ['a refusal', refused('FORBIDDEN'), 'hidden']])('a refused window whose fallback read is %s is that state, never an input error over nothing (#2535)', async (_n, err, kind) => {
    const request = vi.fn().mockRejectedValueOnce(refused('BAD_USER_INPUT')).mockRejectedValueOnce(err);
    const view = await loadTeamMetrics({ request } as never, 'app1', { since: '2026-01-01T00:00:00.000Z', until: '2026-06-01T00:00:00.000Z' });
    expect(view).toEqual({ kind });
  });

  it('an outage is failed, never hidden and never empty', async () => {
    expect(await loadTeamMetrics(clientOf(() => Promise.reject(new Error('boom'))), 'app1')).toEqual({ kind: 'failed' });
  });

  it('a null or workers-less answer is failed', async () => {
    expect(await loadTeamMetrics(clientOf(async () => ({ teamMetrics: null })), 'app1')).toEqual({ kind: 'failed' });
  });
});

describe('windowFromParams', () => {
  it('turns days into UTC instants', () => {
    expect(windowFromParams(new URLSearchParams('since=2026-11-01&until=2026-11-08'))).toEqual({
      since: '2026-11-01T00:00:00.000Z', until: '2026-11-08T00:00:00.000Z', malformed: false,
    });
  });
  it('omitted is omitted', () => {
    expect(windowFromParams(new URLSearchParams(''))).toEqual({ malformed: false });
  });
  it('flags junk instead of guessing', () => {
    expect(windowFromParams(new URLSearchParams('since=yesterday')).malformed).toBe(true);
    expect(windowFromParams(new URLSearchParams('until=2026-13-45')).malformed).toBe(true);
  });
  it('refuses an impossible day instead of rolling it into the next month', () => {
    expect(windowFromParams(new URLSearchParams('since=2026-02-31')).malformed).toBe(true);
    expect(windowFromParams(new URLSearchParams('since=2028-02-29')).malformed).toBe(false);
  });
});
