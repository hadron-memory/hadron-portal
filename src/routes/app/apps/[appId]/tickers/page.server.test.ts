/**
 * portal#1099 — the Tickers list's and a ticker page's loaders: concealment,
 * failures that stay failures, and no write path (S7a). portal#1141 slice A adds
 * the one exception: the list route's `delivery` action (S9 delivery settings).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { APP_DELIVERY_SETTINGS_QUERY, SET_APP_DELIVERY_SETTINGS_MUTATION } from '$lib/server/delivery-settings';
import { CREATE_TICKER_MUTATION } from '$lib/server/ticker-writes';
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

describe('write surface (S7a read-only, then portal#1151 S7b, then portal#1497 controls)', () => {
  it('the list route exports the delivery and create actions; the detail route update, delete, set-enabled, subscribe and unsubscribe', async () => {
    const list = await import('./+page.server');
    const detail = await import('./[tickerId]/+page.server');
    expect(Object.keys((list as { actions?: object }).actions ?? {}).sort()).toEqual(['create', 'delivery']);
    expect(Object.keys((detail as { actions?: object }).actions ?? {}).sort()).toEqual(
      ['delete', 'set-enabled', 'subscribe', 'unsubscribe', 'update'],
    );
  });

  it('the list issues only its reads: tickers, ticker settings and delivery settings (no manage audit)', async () => {
    request.mockImplementation(async (q: string) =>
      q === AGENT_TASKS_APP_QUERY ? { app }
      : q === APP_TICKERS_QUERY ? { tickers: [] }
      : q === APP_DELIVERY_SETTINGS_QUERY ? { appDeliverySettings: delivery }
      : { appTickerSettings: settings },
    );
    await loadList();
    expect(request.mock.calls.map((c) => c[0]).sort()).toEqual(
      [AGENT_TASKS_APP_QUERY, APP_TICKERS_QUERY, APP_TICKER_SETTINGS_QUERY, APP_DELIVERY_SETTINGS_QUERY].sort(),
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
  const reads = (deliveryResult: unknown = { appDeliverySettings: delivery }) => async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === APP_TICKERS_QUERY) return { tickers: [] };
    if (q === APP_TICKER_SETTINGS_QUERY) return { appTickerSettings: settings };
    if (q === APP_DELIVERY_SETTINGS_QUERY) {
      if (deliveryResult && typeof deliveryResult === 'object' && 'response' in deliveryResult) throw deliveryResult;
      return deliveryResult;
    }
    throw new Error(`unexpected ${q}`);
  };

  // Rodolfo's §10 P2 on #1152: effectiveAccess.canManage under-reports owner-role members, so the
  // loader makes no manage audit at all and carries no capability for the page to hide the form by.
  it('makes no manage audit and returns no capability: nobody the server admits is hidden', async () => {
    request.mockImplementation(reads());
    const r = await loadList();
    expect(r.delivery).toEqual({ kind: 'ok', value: delivery });
    expect(r).not.toHaveProperty('canManage');
    expect(request.mock.calls.some((c) => String(c[0]).includes('effectiveAccess'))).toBe(false);
  });

  it('a failed delivery read is a failure, the page still loads, and no defaults are invented', async () => {
    request.mockImplementation(reads(gqlError('INTERNAL_SERVER_ERROR') as never));
    const r = await loadList();
    expect(r.delivery).toEqual({ kind: 'failed' });
    expect(r.settings).toEqual({ kind: 'ok', value: settings });
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

describe('portal#1151 — the create action', () => {
  function event(fields: Record<string, string | string[]>, impersonation: unknown = null) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
    return { request: { formData: async () => fd }, params: { appId: 'app-1' }, locals: { token: 'tok', user: { id: 'u1' }, impersonation } } as never;
  }
  const good = { name: 'standup', cadenceSeconds: '600', reasons: ['READ_TEAM_CHANNEL'] };
  async function run(fields: Record<string, string | string[]>, impersonation: unknown = null) {
    const { actions } = (await import('./+page.server')) as unknown as { actions: Record<string, (e: never) => Promise<unknown>> };
    return actions.create(event(fields, impersonation));
  }

  it('creates with an explicit reasons set and nothing else', async () => {
    rawRequest.mockResolvedValue({ data: { createTicker: { id: 'tk-9', name: 'standup' } }, extensions: {} });
    expect(await run(good)).toEqual({ action: 'create', ok: true, ticker: { id: 'tk-9', name: 'standup' }, committedWithError: false, warnings: [], more: 0 });
    expect(rawRequest).toHaveBeenCalledTimes(1);
    expect(rawRequest).toHaveBeenCalledWith(CREATE_TICKER_MUTATION, {
      appRef: 'app-1',
      input: { name: 'standup', cadenceSeconds: 600, reasons: ['READ_TEAM_CHANNEL'] },
    });
  });

  it('an empty reasons set answers 400 on the reasons field and calls nothing', async () => {
    const r = (await run({ name: 'a', cadenceSeconds: '60' })) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ action: 'create', refusal: { kind: 'invalid', field: 'reasons' } });
    expect(rawRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['TICKER_NAME_TAKEN', 409],
    ['TICKER_LIMIT_REACHED', 409],
    ['TICKER_CADENCE_OUT_OF_RANGE', 400],
    ['APP_NOT_FOUND', 404],
  ])('%s is the server’s sentence with the typed values, never a success', async (code, status) => {
    rawRequest.mockRejectedValueOnce(gqlError(code));
    const r = (await run(good)) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(status);
    expect(r.data).toMatchObject({ action: 'create', refusal: { kind: 'refused', code, message: code }, values: { name: 'standup' } });
    expect(r.data).not.toHaveProperty('ok');
  });

  it('the cap and the name refusals have their own codes (not one generic line)', async () => {
    rawRequest.mockRejectedValueOnce(gqlError('TICKER_LIMIT_REACHED', 'The App has reached its ticker limit.'));
    const r = (await run(good)) as { data: { refusal: { message: string } } };
    expect(r.data.refusal.message).toBe('The App has reached its ticker limit.');
  });

  it('an unknown failure is uncertain, shows no raw text and is not retried', async () => {
    rawRequest.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'prisma stack'));
    const r = (await run(good)) as { data: Record<string, unknown> };
    expect(r.data).toMatchObject({ refusal: { kind: 'uncertain' } });
    expect(JSON.stringify(r.data)).not.toContain('prisma');
    expect(rawRequest).toHaveBeenCalledTimes(1);
  });

  it('an impersonation session writes nothing', async () => {
    const r = (await run(good, { sessionId: 's', actorUserId: 'a', orgId: 'o', expiresAt: 0 })) as { status: number };
    expect(r.status).toBe(403);
    expect(rawRequest).not.toHaveBeenCalled();
  });

  // portal#1384 acceptance 9 (R1 = B, the second PR): the warning a successful create may carry.
  // The server files it in `extensions.warnings` under the mutation's response key, after the
  // write committed; the create stays a success and the warning's text and code are shown as given.
  const unmapped = { path: 'createTicker', code: 'ticker.code.unmapped', text: 'No task is mapped to this ticker’s code in the App’s register.' };
  const created = { data: { createTicker: { id: 'tk-9', name: 'standup' } } };

  it('a create that carries ticker.code.unmapped is still a success and returns the warning verbatim', async () => {
    rawRequest.mockResolvedValue({ ...created, extensions: { warnings: [unmapped] } });
    expect(await run(good)).toEqual({
      action: 'create', ok: true, ticker: { id: 'tk-9', name: 'standup' }, committedWithError: false,
      warnings: [{ code: 'ticker.code.unmapped', text: unmapped.text }], more: 0,
    });
  });

  it('a warning under another path, or none, shows no warnings', async () => {
    rawRequest.mockResolvedValueOnce({ ...created, extensions: { warnings: [{ ...unmapped, path: 'createAgentTask' }] } });
    expect(await run(good)).toMatchObject({ ok: true, warnings: [], more: 0 });
    rawRequest.mockResolvedValueOnce({ ...created, extensions: {} });
    expect(await run(good)).toMatchObject({ ok: true, warnings: [], more: 0 });
  });

  it('an answer with no usable ticker and no warning to prove the write is uncertain, never "created"', async () => {
    rawRequest.mockResolvedValue({ data: { createTicker: null }, extensions: {} });
    const r = (await run(good)) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(502);
    expect(r.data).toMatchObject({ action: 'create', refusal: { kind: 'uncertain' } });
    expect(r.data).not.toHaveProperty('ok');
  });

  // Caspian's BLIND P2 on #1467: `committed` means a warning NAMED this path, so an answer with
  // no usable ticker but a warning under the path is a committed create, never "uncertain" (which
  // would invite a duplicate retry). The guard above is the other half of this pair.
  it('an answer with no ticker but a warning under the path is a committed create, not uncertain', async () => {
    rawRequest.mockResolvedValue({ data: { createTicker: null }, extensions: { warnings: [unmapped] } });
    expect(await run(good)).toEqual({
      action: 'create', ok: true, ticker: null, committedWithError: false,
      warnings: [{ code: 'ticker.code.unmapped', text: unmapped.text }], more: 0,
    });
  });

  it('an unknown warning code under the path passes through verbatim, never reworded', async () => {
    rawRequest.mockResolvedValue({ ...created, extensions: { warnings: [{ path: 'createTicker', code: 'ticker.future.thing', text: 'Fixed server text.' }] } });
    expect(await run(good)).toMatchObject({ warnings: [{ code: 'ticker.future.thing', text: 'Fixed server text.' }] });
  });

  it('a response that errored but filed a warning under this path is a committed create, not a refusal', async () => {
    rawRequest.mockRejectedValueOnce({ response: { data: { createTicker: { id: 'tk-9', name: 'standup' } }, errors: [{ message: 'late', extensions: { code: 'INTERNAL_SERVER_ERROR' } }], extensions: { warnings: [unmapped] } } });
    const r = (await run(good)) as Record<string, unknown>;
    expect(r).toMatchObject({ action: 'create', ok: true, committedWithError: true, warnings: [{ code: 'ticker.code.unmapped' }] });
    expect(JSON.stringify(r)).not.toContain('late');
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

  it('the list still issues no task read', async () => {
    request.mockImplementation(async (q: string) =>
      q === AGENT_TASKS_APP_QUERY ? { app } : q === APP_TICKERS_QUERY ? { tickers: [] } : q === APP_DELIVERY_SETTINGS_QUERY ? { appDeliverySettings: delivery } : { appTickerSettings: settings },
    );
    await loadList();
    expect(request.mock.calls.some((c) => c[0] === TICKER_TASK_QUERY)).toBe(false);
  });
});
