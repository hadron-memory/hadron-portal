/**
 * portal#1099 — the Tickers list's and a ticker page's loaders: concealment,
 * failures that stay failures, and no write path (S7a). portal#1141 slice A adds
 * the one exception: the list route's `delivery` action (S9 delivery settings).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { APP_DELIVERY_SETTINGS_QUERY, SET_APP_DELIVERY_SETTINGS_MUTATION } from '$lib/server/delivery-settings';
import { SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';
import { APP_TICKER_SETTINGS_QUERY, APP_TICKERS_QUERY, TICKER_QUERY, TICKER_SUBSCRIBERS_QUERY } from '$lib/server/tickers';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const settings = { minCadenceSeconds: 120, selfSubscribeCadenceSeconds: 600, liveCap: 20, dailyWakeBudget: 500, dailyWakeBudgetDerived: true };
const delivery = { batchWindowSeconds: 120, busyDelaySeconds: 600, stuckWindowSeconds: 900, standbyEnabled: false, standbyEffective: false };
const gqlError = (code: string, message = code) => ({ response: { errors: [{ message, extensions: { code } }] } });
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
  it('the list route exports only the delivery action; the detail route none', async () => {
    const list = await import('./+page.server');
    const detail = await import('./[tickerId]/+page.server');
    expect(Object.keys((list as { actions?: object }).actions ?? {})).toEqual(['delivery']);
    expect('actions' in detail).toBe(false);
  });

  it('the list issues only its reads: tickers, ticker settings, delivery settings and the manage hint', async () => {
    request.mockImplementation(async (q: string) =>
      q === AGENT_TASKS_APP_QUERY ? { app }
      : q === APP_TICKERS_QUERY ? { tickers: [] }
      : q === APP_DELIVERY_SETTINGS_QUERY ? { appDeliverySettings: delivery }
      : q === SELF_CAN_MANAGE_QUERY ? { effectiveAccess: { canManage: true } }
      : { appTickerSettings: settings },
    );
    await loadList();
    expect(request.mock.calls.map((c) => c[0]).sort()).toEqual(
      [AGENT_TASKS_APP_QUERY, APP_TICKERS_QUERY, APP_TICKER_SETTINGS_QUERY, APP_DELIVERY_SETTINGS_QUERY, SELF_CAN_MANAGE_QUERY].sort(),
    );
    expect(request.mock.calls.some((c) => String(c[0]).includes('mutation'))).toBe(false);
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

describe('portal#1141 A — delivery settings on the list loader', () => {
  const reads = (canManage: unknown, deliveryResult: unknown = { appDeliverySettings: delivery }) => async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === APP_TICKERS_QUERY) return { tickers: [] };
    if (q === APP_TICKER_SETTINGS_QUERY) return { appTickerSettings: settings };
    if (q === SELF_CAN_MANAGE_QUERY) {
      if (canManage === 'throw') throw gqlError('FORBIDDEN');
      return { effectiveAccess: { canManage } };
    }
    if (q === APP_DELIVERY_SETTINGS_QUERY) {
      if (deliveryResult && typeof deliveryResult === 'object' && 'response' in deliveryResult) throw deliveryResult;
      return deliveryResult;
    }
    throw new Error(`unexpected ${q}`);
  };

  it.each([[true, true], [false, false], ['throw', null]])('canManage %s loads as %s (unknown stays null, never false)', async (read, expected) => {
    request.mockImplementation(reads(read));
    const r = await loadList();
    expect(r.canManage).toBe(expected);
    expect(r.delivery).toEqual({ kind: 'ok', value: delivery });
  });

  it('a failed delivery read is a failure, the page still loads, and no defaults are invented', async () => {
    request.mockImplementation(reads(true, gqlError('INTERNAL_SERVER_ERROR') as never));
    const r = await loadList();
    expect(r.delivery).toEqual({ kind: 'failed' });
    expect(r.settings).toEqual({ kind: 'ok', value: settings });
  });

  it('is unknown (null) when there is no signed-in user, without asking', async () => {
    request.mockImplementation(reads(true));
    const { load } = await import('./+page.server');
    const r = (await load({ params: { appId: 'app-1' }, locals: { token: 'tok', user: null, impersonation: null }, url: new URL('http://localhost/x') } as never)) as Record<string, unknown>;
    expect(r.canManage).toBeNull();
    expect(request.mock.calls.some((c) => c[0] === SELF_CAN_MANAGE_QUERY)).toBe(false);
  });
});

describe('portal#1141 A — the delivery action', () => {
  function event(fields: Record<string, string>, impersonation: unknown = null) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return { request: { formData: async () => fd }, params: { appId: 'app-1' }, locals: { token: 'tok', user: { id: 'u1' }, impersonation } } as never;
  }
  const was = { batchWindowSecondsWas: '120', busyDelaySecondsWas: '600', stuckWindowSecondsWas: '900' };
  const same = { batchWindowSeconds: '120', busyDelaySeconds: '600', stuckWindowSeconds: '900' };
  async function run(fields: Record<string, string>, impersonation: unknown = null) {
    const { actions } = (await import('./+page.server')) as unknown as { actions: Record<string, (e: never) => Promise<unknown>> };
    return actions.delivery(event(fields, impersonation));
  }

  it('sends only the changed fields, and nothing else, to setAppDeliverySettings', async () => {
    request.mockResolvedValue({});
    expect(await run({ ...was, ...same, busyDelaySeconds: '300' })).toEqual({ action: 'delivery', ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(SET_APP_DELIVERY_SETTINGS_MUTATION, { appRef: 'app-1', input: { busyDelaySeconds: 300 } });
  });

  it('nothing changed calls nothing', async () => {
    const r = (await run({ ...was, ...same })) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ action: 'delivery', refusal: { kind: 'invalid', field: 'form' } });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['TICKER_SETTINGS_CONFLICT', 400],
    ['TICKER_SETTINGS_OUT_OF_RANGE', 400],
    ['DELIVERY_SETTINGS_CONFLICT', 400],
    ['DELIVERY_SETTINGS_OUT_OF_RANGE', 400],
    ['APP_NOT_FOUND', 404],
  ])('%s comes back as the server’s sentence with the typed values, never a success', async (code, status) => {
    request.mockRejectedValueOnce(gqlError(code));
    const r = (await run({ ...was, ...same, batchWindowSeconds: '600' })) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(status);
    expect(r.data).toMatchObject({
      action: 'delivery',
      refusal: { kind: 'refused', code, message: code },
      values: { batchWindowSeconds: '600' },
    });
    expect(r.data).not.toHaveProperty('ok');
  });

  it('a non-manager gets the server’s FORBIDDEN sentence', async () => {
    const sentence = 'Only whoever manages this App can change its settings.';
    request.mockRejectedValueOnce(gqlError('FORBIDDEN', sentence));
    const r = (await run({ ...was, ...same, busyDelaySeconds: '5' })) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(403);
    expect(r.data).toMatchObject({ refusal: { kind: 'refused', code: 'FORBIDDEN', message: sentence } });
  });

  it('an unknown failure is uncertain, never the raw text, and is not retried', async () => {
    request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'prisma stack'));
    const r = (await run({ ...was, ...same, busyDelaySeconds: '5' })) as { status: number; data: Record<string, unknown> };
    expect(r.data).toMatchObject({ refusal: { kind: 'uncertain' } });
    expect(JSON.stringify(r.data)).not.toContain('prisma');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('an impersonation session writes nothing', async () => {
    const r = (await run({ ...was, ...same, busyDelaySeconds: '5' }, { sessionId: 's', actorUserId: 'a', orgId: 'o', expiresAt: 0 })) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
});
