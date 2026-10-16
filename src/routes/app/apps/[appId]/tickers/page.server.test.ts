/**
 * portal#1099 — the Tickers list's and a ticker page's loaders: concealment,
 * failures that stay failures, and no write path (S7a).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { APP_TICKER_SETTINGS_QUERY, APP_TICKERS_QUERY, TICKER_QUERY, TICKER_SUBSCRIBERS_QUERY } from '$lib/server/tickers';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const settings = { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 500, dailyWakeBudgetDerived: true };
const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });
const ticker = { id: 'tk-1', name: 'engineering', app: { id: 'app-1' } };

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function loadList() {
  const { load } = await import('./+page.server');
  return (await load({
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL('http://localhost/app/apps/app-1/tickers'),
  } as never)) as Record<string, unknown>;
}

async function loadDetail(search = '') {
  const { load } = await import('./[tickerId]/+page.server');
  return (await load({
    params: { appId: 'app-1', tickerId: 'tk-1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
    url: new URL(`http://localhost/app/apps/app-1/tickers/tk-1${search}`),
  } as never)) as Record<string, unknown>;
}

describe('no write path (S7a, Holger via Vera #11540)', () => {
  it('neither route exports form actions', async () => {
    const list = await import('./+page.server');
    const detail = await import('./[tickerId]/+page.server');
    expect('actions' in list).toBe(false);
    expect('actions' in detail).toBe(false);
  });

  it('the list issues only its three reads', async () => {
    request.mockImplementation(async (q: string) =>
      q === AGENT_TASKS_APP_QUERY ? { app } : q === APP_TICKERS_QUERY ? { tickers: [] } : { appTickerSettings: settings },
    );
    await loadList();
    expect(request.mock.calls.map((c) => c[0]).sort()).toEqual([AGENT_TASKS_APP_QUERY, APP_TICKERS_QUERY, APP_TICKER_SETTINGS_QUERY].sort());
  });
});

describe('list loader', () => {
  it('reads tickers and settings for the App', async () => {
    request.mockImplementation(async (q: string) =>
      q === AGENT_TASKS_APP_QUERY ? { app } : q === APP_TICKERS_QUERY ? { tickers: [{ id: 'tk-1' }] } : { appTickerSettings: settings },
    );
    const r = await loadList();
    expect(r.tickers).toEqual({ kind: 'ok', value: [{ id: 'tk-1' }] });
    expect(r.settings).toEqual({ kind: 'ok', value: settings });
  });

  it('a viewer refused the App (FORBIDDEN) gets the App page’s 404', async () => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    await expect(loadList()).rejects.toMatchObject({ status: 404 });
  });

  it('a missing App (NOT_FOUND) is a 404 too', async () => {
    request.mockRejectedValueOnce(gqlError('NOT_FOUND'));
    await expect(loadList()).rejects.toMatchObject({ status: 404 });
  });

  it('a server fault on the App read stays a failure, never a 404', async () => {
    request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR'));
    await expect(loadList()).rejects.not.toMatchObject({ status: 404 });
  });

  it('a viewer who sees the App but doesn’t take part gets the inline not-participant state', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      throw gqlError('APP_NOT_FOUND');
    });
    const r = await loadList();
    expect(r.tickers).toEqual({ kind: 'not-participant' });
    expect(r.settings).toEqual({ kind: 'not-participant' });
  });

  it('a failed ticker read is a failure state, not an empty list', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === APP_TICKERS_QUERY) throw gqlError('INTERNAL_SERVER_ERROR');
      return { appTickerSettings: settings };
    });
    expect((await loadList()).tickers).toEqual({ kind: 'failed' });
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
