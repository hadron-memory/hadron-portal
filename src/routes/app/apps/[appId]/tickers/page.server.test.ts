/**
 * portal#1099 — a ticker page's loader: concealment and failures that stay failures. The list moved into the App's
 * Settings (see tickers-section.server.test.ts).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { APP_TICKER_SETTINGS_QUERY, APP_TICKERS_QUERY, TICKER_QUERY, TICKER_SUBSCRIBERS_QUERY, TICKER_TASK_QUERY } from '$lib/server/tickers';

const request = vi.fn();
const rawRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request, rawRequest }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const settings = { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 500, dailyWakeBudgetDerived: true };
const delivery = { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false };
const gqlError = (code: string, message = code) => ({ response: { errors: [{ message, extensions: { code } }] } });
const ticker = { id: 'tk-1', name: 'engineering', app: { id: 'app-1' } };

beforeEach(() => {
  request.mockReset();
  rawRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function loadDetail(search = '') {
  const { load } = await import('./[tickerId]/+page.server');
  return (await load({
    params: { appId: 'app-1', tickerId: 'tk-1' },
    parent: async () => ({}),
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/apps/app-1/tickers/tk-1${search}`),
  } as never)) as Record<string, unknown>;
}

describe('write surface (portal#1497 controls)', () => {
  it('the detail route exports update, delete, set-enabled, subscribe and unsubscribe', async () => {
    const detail = await import('./[tickerId]/+page.server');
    expect(Object.keys((detail as { actions?: object }).actions ?? {}).sort()).toEqual(
      ['delete', 'set-enabled', 'subscribe', 'unsubscribe', 'update'],
    );
  });
});

describe('ticker page loader', () => {
  it('reads the ticker, its first subscribers and the App’s settings', async () => {
    request.mockImplementation(async (q: string) =>
      q === AGENT_TASKS_APP_QUERY ? { app }
        : q === TICKER_QUERY ? { ticker }
          : q === TICKER_SUBSCRIBERS_QUERY ? { ticker: { subscribers: { items: [], hasNextPage: false, endCursor: null } } }
            : { appTickerSettings: settings },
    );
    const r = await loadDetail();
    expect(r.subscribers).toEqual({ kind: 'ok', value: { items: [], hasNextPage: false, endCursor: null } });
    expect(r.paged).toBe(false);
    expect(request).toHaveBeenCalledWith(TICKER_SUBSCRIBERS_QUERY, expect.objectContaining({ ref: 'tk-1', after: null }));
  });

  it('pages forward with ?after=', async () => {
    request.mockImplementation(async (q: string) =>
      q === AGENT_TASKS_APP_QUERY ? { app } : q === TICKER_QUERY ? { ticker } : q === TICKER_SUBSCRIBERS_QUERY ? { ticker: { subscribers: { items: [], hasNextPage: false, endCursor: null } } } : { appTickerSettings: settings },
    );
    const r = await loadDetail('?after=sub-9');
    expect(r.paged).toBe(true);
    expect(request).toHaveBeenCalledWith(TICKER_SUBSCRIBERS_QUERY, expect.objectContaining({ after: 'sub-9' }));
  });

  it('a missing or unreachable ticker (the server answers null for both) is a 404', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { ticker: null }));
    await expect(loadDetail()).rejects.toMatchObject({ status: 404 });
  });

  it('a server fault on the ticker read stays a failure, never a 404', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      throw gqlError('INTERNAL_SERVER_ERROR');
    });
    await expect(loadDetail()).rejects.not.toMatchObject({ status: 404 });
  });

  it('a ticker of another App redirects to its canonical address', async () => {
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { ticker: { ...ticker, app: { id: 'app-2' } } }));
    await expect(loadDetail('?after=x')).rejects.toMatchObject({ status: 307, location: '/app/apps/app-2/tickers/tk-1?after=x' });
  });

  it('a viewer refused the App gets the App page’s 404 before any ticker read', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    await expect(loadDetail()).rejects.toMatchObject({ status: 404 });
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('portal#1384 — the ticker page’s task read', () => {
  const reads = (task: (q: string) => unknown) => async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === TICKER_QUERY) return { ticker };
    if (q === TICKER_TASK_QUERY) return task(q);
    if (q === TICKER_SUBSCRIBERS_QUERY) return { ticker: { subscribers: { items: [], hasNextPage: false, endCursor: null } } };
    return { appTickerSettings: settings };
  };

  it('reads the task on its own, for this ticker, after the App-first 404 and the canonical redirect', async () => {
    request.mockImplementation(reads(() => ({ ticker: { id: 'tk-1', registerTaskLoc: 'tasks:on-base-tick' } })));
    const r = await loadDetail();
    expect(r.tickerTask).toEqual({ kind: 'ok', value: { registerTaskLoc: 'tasks:on-base-tick' } });
    expect(request).toHaveBeenCalledWith(TICKER_TASK_QUERY, { ref: 'tk-1' });
    request.mockReset();
    request.mockImplementation(async (q: string) => (q === AGENT_TASKS_APP_QUERY ? { app } : { ticker: { ...ticker, app: { id: 'app-2' } } }));
    await expect(loadDetail()).rejects.toMatchObject({ status: 307 });
    expect(request.mock.calls.some((c) => c[0] === TICKER_TASK_QUERY)).toBe(false);
  });

  it('a null register field is an ok read with a null loc', async () => {
    request.mockImplementation(reads(() => ({ ticker: { id: 'tk-1', registerTaskLoc: null } })));
    expect((await loadDetail()).tickerTask).toEqual({ kind: 'ok', value: { registerTaskLoc: null } });
  });

  it('a failed task read leaves the facts, the subscribers and the settings intact', async () => {
    request.mockImplementation(reads(() => { throw gqlError('INTERNAL_SERVER_ERROR', 'boom: secret server prose'); }));
    const r = await loadDetail();
    expect(r.tickerTask).toEqual({ kind: 'failed' });
    expect(r.ticker).toMatchObject({ id: 'tk-1' });
    expect(r.subscribers).toEqual({ kind: 'ok', value: { items: [], hasNextPage: false, endCursor: null } });
    expect(r.settings).toEqual({ kind: 'ok', value: settings });
  });

  it('a network failure is a failure, never a null loc', async () => {
    request.mockImplementation(reads(() => { throw new Error('ECONNREFUSED'); }));
    expect((await loadDetail()).tickerTask).toEqual({ kind: 'failed' });
  });

  it('APP_NOT_FOUND is not-participant; any other code, FORBIDDEN included, is a failure', async () => {
    request.mockImplementation(reads(() => { throw gqlError('APP_NOT_FOUND'); }));
    expect((await loadDetail()).tickerTask).toEqual({ kind: 'not-participant' });
    request.mockImplementation(reads(() => { throw gqlError('FORBIDDEN'); }));
    expect((await loadDetail()).tickerTask).toEqual({ kind: 'failed' });
  });

  it('the ticker gone between the two reads (null outer) is an ok read of null, not an authoritative “no mapping”', async () => {
    request.mockImplementation(reads(() => ({ ticker: null })));
    expect((await loadDetail()).tickerTask).toEqual({ kind: 'ok', value: null });
  });
});
