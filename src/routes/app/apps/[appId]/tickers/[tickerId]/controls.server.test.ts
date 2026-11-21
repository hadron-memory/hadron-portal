/**
 * portal#1497 (MCP cut R7a) — the ticker page's three stateful controls:
 * turn the ticker on or off, subscribe a worker, unsubscribe one.
 *
 * The wire is mocked at the client, and the route's two guard reads
 * (`loadTasksApp`, `loadTicker`) are mocked as modules, so a test sees the
 * exact mutation document, its variables, and that NOTHING else is sent: the
 * route-to-ticker App check is the only read, and no diagnostic existence
 * probe tells the not-available cases apart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_TICKER_ENABLED_MUTATION, SUBSCRIBE_WORKER_MUTATION, UNSUBSCRIBE_WORKER_MUTATION } from '$lib/server/ticker-writes';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const APP = { id: 'app-1', urn: 'hrn:app:acme.com:team', name: 'Team' };
const TICKER = { id: 'tk-1', urn: 'hrn:ticker:acme.com:team:standup', name: 'Standup', slug: 'standup', app: { id: 'app-1' } };

const loadTasksApp = vi.fn();
const loadTicker = vi.fn();
vi.mock('$lib/server/agent-tasks', () => ({ loadTasksApp: (...a: unknown[]) => loadTasksApp(...a) }));
vi.mock('$lib/server/tickers', () => ({
  loadTicker: (...a: unknown[]) => loadTicker(...a),
  loadSubscribers: vi.fn(),
  loadAppTickerSettings: vi.fn(),
  loadTickerRoster: vi.fn(),
}));

const gqlError = (code: string, message = code, extensions: Record<string, unknown> = {}) => ({
  response: { errors: [{ message, extensions: { code, ...extensions } }] },
});

beforeEach(() => {
  request.mockReset();
  loadTasksApp.mockReset().mockResolvedValue(APP);
  loadTicker.mockReset().mockResolvedValue(TICKER);
});

describe('portal#1497 — the actions’ event', () => {
  function event(fields: Record<string, string | string[]>, impersonation: unknown = null, routeTickerId = 'tk-1') {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
    return {
      request: { formData: async () => fd },
      // portal#1515: the route may spell the ticker as a URN or alias — the
      // default is the bare canonical id, as every earlier test posted it.
      params: { appId: 'app-1', tickerId: routeTickerId },
      locals: { token: 'tok', user: { id: 'u1' }, impersonation },
    } as never;
  }
  type Actions = Record<string, (e: never) => Promise<unknown>>;
  async function actions(): Promise<Actions> {
    return ((await import('./+page.server')) as unknown as { actions: Actions }).actions;
  }
  const run = async (
    name: 'set-enabled' | 'subscribe' | 'unsubscribe',
    fields: Record<string, string | string[]>,
    impersonation: unknown = null,
    routeTickerId = 'tk-1',
  ) => (await actions())[name](event(fields, impersonation, routeTickerId));
  const imp = { sessionId: 's', actorUserId: 'a', orgId: 'o', expiresAt: 0 };
  /** The refusal an action returned, with its HTTP status. */
  const refusalOf = (r: unknown) => (r as { status: number; data: { refusal: { kind: string; code?: string; message: string } } }).data.refusal;
  const NOT_AVAILABLE = 'This ticker or worker isn’t available to you. Reload the page.';

  describe('set-enabled', () => {
    it('posts the desired value and checks the echo before calling it a success', async () => {
      request.mockResolvedValue({ updateTicker: { id: 'tk-1', enabled: false } });
      const r = await run('set-enabled', { enabled: 'false' });
      expect(r).toMatchObject({ action: 'set-enabled', ok: true, target: { tickerId: 'tk-1' } });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(SET_TICKER_ENABLED_MUTATION, { ref: 'tk-1', input: { enabled: false } });
    });

    it.each([
      ['turning it on', 'true', true],
      ['turning it off', 'false', false],
    ] as const)('%s sends exactly that boolean, never a toggle', async (_label, posted, desired) => {
      request.mockResolvedValue({ updateTicker: { id: 'tk-1', enabled: desired } });
      await run('set-enabled', { enabled: posted });
      expect(request).toHaveBeenCalledWith(SET_TICKER_ENABLED_MUTATION, { ref: 'tk-1', input: { enabled: desired } });
    });

    it('an echo that does not equal the desire is uncertain, never a success', async () => {
      request.mockResolvedValue({ updateTicker: { id: 'tk-1', enabled: true } });
      const r = (await run('set-enabled', { enabled: 'false' })) as { status: number };
      expect(r.status).toBe(502);
      expect(refusalOf(r).kind).toBe('uncertain');
    });

    it.each([
      ['missing', {}],
      ['not a boolean', { enabled: 'yes' }],
      ['repeated', { enabled: ['true', 'false'] }],
    ])('an %s enabled value is invalid and sends nothing', async (_label, fields) => {
      const r = (await run('set-enabled', fields)) as { status: number };
      expect(r.status).toBe(400);
      expect(refusalOf(r).kind).toBe('invalid');
      expect(request).not.toHaveBeenCalled();
    });

    it('a FORBIDDEN for someone without edit authority is fixed portal copy, 403', async () => {
      request.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Forbidden'));
      const r = (await run('set-enabled', { enabled: 'false' })) as { status: number };
      expect(r.status).toBe(403);
      expect(refusalOf(r)).toMatchObject({ kind: 'refused', code: 'FORBIDDEN' });
      expect(refusalOf(r).message).not.toContain('Forbidden');
    });

    it('INTERNAL_SERVER_ERROR is the fixed internal line plus its request id', async () => {
      request.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR', 'SELECT private FROM /srv/private.ts', { requestId: 'a4451409-72f6-4f08-b90b-f8db328e8c58' }));
      const r = (await run('set-enabled', { enabled: 'false' })) as { status: number };
      expect(r.status).toBe(500);
      expect(refusalOf(r).message).toContain('Something went wrong on our side.');
      expect(refusalOf(r).message).toContain('a4451409-72f6-4f08-b90b-f8db328e8c58');
      const text = JSON.stringify(r);
      expect(text).not.toContain('SELECT private');
      expect(text).not.toContain('/srv/private.ts');
    });

    it('an unknown stamped code is a definite refusal with one generic sentence; a transport failure is uncertain', async () => {
      // portal#1502 (review, Gaby): a typed error is an answer, not an outage —
      // the write certainly did not happen, so it may not wear the
      // maybe-went-through copy. Only transport and parse failures are uncertain.
      request.mockRejectedValueOnce(gqlError('SOMETHING_NEW', 'nope'));
      const r = (await run('set-enabled', { enabled: 'false' })) as { status: number };
      expect(r.status).toBe(400);
      expect(refusalOf(r)).toMatchObject({ kind: 'refused', code: 'SOMETHING_NEW' });
      expect(refusalOf(r).message).toBe('This change was refused, so nothing was changed.');
      expect(refusalOf(r).message).not.toContain('nope');
      request.mockRejectedValueOnce(new Error('socket hang up'));
      expect(refusalOf(await run('set-enabled', { enabled: 'false' })).kind).toBe('uncertain');
    });
  });

  describe('route-to-ticker App check (before any mutation)', () => {
    it('a person in Apps A and B posting B’s ticker under A’s path is refused with the one sentence and zero mutations', async () => {
      loadTicker.mockResolvedValueOnce({ ...TICKER, app: { id: 'app-2' } });
      const r = (await run('subscribe', { worker: 'w-2' })) as { status: number };
      expect(r.status).toBe(404);
      expect(refusalOf(r)).toMatchObject({ kind: 'refused', code: 'TICKER_NOT_FOUND', message: NOT_AVAILABLE });
      expect(request).not.toHaveBeenCalled();
    });

    it('an unreadable (null) ticker under A’s path is the same sentence, zero mutations', async () => {
      loadTicker.mockResolvedValueOnce(null);
      const r = (await run('set-enabled', { enabled: 'false' })) as { status: number };
      expect(refusalOf(r).message).toBe(NOT_AVAILABLE);
      expect(request).not.toHaveBeenCalled();
    });

    it('an App the viewer cannot read is the same sentence, zero mutations', async () => {
      loadTasksApp.mockResolvedValueOnce(null);
      const r = (await run('unsubscribe', { worker: 'w-2' })) as { status: number };
      expect(refusalOf(r).message).toBe(NOT_AVAILABLE);
      expect(request).not.toHaveBeenCalled();
    });

    it('the check reads the ticker the way the loader does: loadTasksApp(appId), then the ticker’s own App', async () => {
      request.mockResolvedValue({ subscribeWorker: { announcement: null, subscription: { id: 's1', endedAt: null } } });
      await run('subscribe', { worker: 'w-2' });
      expect(loadTasksApp).toHaveBeenCalledWith(expect.anything(), 'app-1');
      expect(loadTicker).toHaveBeenCalledWith(expect.anything(), 'tk-1');
    });
  });

  describe('a URN-spelled route still keys the mutation by the CANONICAL id (portal#1515)', () => {
    // Riana §10 P3-1 on #1502: the URL may spell the ticker as a URN or alias;
    // the guard resolved that spelling to the canonical id, and each mutation
    // must be keyed by exactly that id — the server re-resolving the route
    // spelling could diverge from the association the guard just proved
    // (#1497 review). The fixture ticker's own URN is the route's spelling
    // here; the canonical id it resolves to is tk-1.
    const URN_ROUTE = TICKER.urn;

    it('set-enabled sends the guard’s canonical id, never the route’s spelling', async () => {
      request.mockResolvedValue({ updateTicker: { id: 'tk-1', enabled: false } });
      const r = await run('set-enabled', { enabled: 'false' }, null, URN_ROUTE);
      // The guard read the route's spelling to resolve the ticker…
      expect(loadTicker).toHaveBeenCalledWith(expect.anything(), URN_ROUTE);
      // …but the mutation is keyed by the canonical id that read proved.
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(SET_TICKER_ENABLED_MUTATION, { ref: 'tk-1', input: { enabled: false } });
      expect(r).toMatchObject({ action: 'set-enabled', ok: true, target: { tickerId: 'tk-1' } });
    });

    it('subscribe sends the guard’s canonical id, never the route’s spelling', async () => {
      request.mockResolvedValue({ subscribeWorker: { announcement: null, subscription: { id: 's1', endedAt: null } } });
      const r = await run('subscribe', { worker: 'w-2' }, null, URN_ROUTE);
      expect(loadTicker).toHaveBeenCalledWith(expect.anything(), URN_ROUTE);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(SUBSCRIBE_WORKER_MUTATION, { tickerRef: 'tk-1', workerRef: 'w-2' });
      expect(r).toMatchObject({ action: 'subscribe', ok: true, target: 'w-2' });
    });

    it('unsubscribe sends the guard’s canonical id, never the route’s spelling', async () => {
      request.mockResolvedValue({ unsubscribeWorker: { announcement: null, subscription: { id: 's1', endedAt: '2026-10-31T00:00:00Z' } } });
      const r = await run('unsubscribe', { worker: 'w-2' }, null, URN_ROUTE);
      expect(loadTicker).toHaveBeenCalledWith(expect.anything(), URN_ROUTE);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request).toHaveBeenCalledWith(UNSUBSCRIBE_WORKER_MUTATION, { tickerRef: 'tk-1', workerRef: 'w-2' });
      expect(r).toMatchObject({ action: 'unsubscribe', ok: true, target: 'w-2' });
    });
  });

  describe('subscribe', () => {
    const OK = { subscribeWorker: { announcement: null, subscription: { id: 's1', endedAt: null } } };

    it('sends the canonical ticker id and the worker ref exactly as posted', async () => {
      request.mockResolvedValue(OK);
      const r = await run('subscribe', { worker: 'hrn:worker:acme.com:team:gaby' });
      expect(request).toHaveBeenCalledWith(SUBSCRIBE_WORKER_MUTATION, { tickerRef: 'tk-1', workerRef: 'hrn:worker:acme.com:team:gaby' });
      expect(r).toMatchObject({ action: 'subscribe', ok: true, target: 'hrn:worker:acme.com:team:gaby' });
    });

    it('a subscription that comes back already ended is not a success', async () => {
      request.mockResolvedValue({ subscribeWorker: { announcement: null, subscription: { id: 's1', endedAt: '2026-10-01T00:00:00Z' } } });
      const r = (await run('subscribe', { worker: 'w-2' })) as { status: number };
      expect(r.status).toBe(502);
      expect(refusalOf(r).kind).toBe('uncertain');
    });

    it.each([true, false] as const)('SUBSCRIBE_FORBIDDEN has one portal sentence per value of extensions.held (held=%s)', async (held) => {
      request.mockRejectedValueOnce(gqlError('SUBSCRIBE_FORBIDDEN', 'server prose', { held }));
      const r = (await run('subscribe', { worker: 'w-2' })) as { status: number };
      expect(r.status).toBe(403);
      const message = refusalOf(r).message;
      expect(message).not.toContain('server prose');
      if (held) {
        expect(message).toContain('Only this worker’s holder or whoever manages the App');
      } else {
        expect(message).toContain('held by nobody');
      }
    });

    it('the two held variants are different sentences', async () => {
      const messages: string[] = [];
      for (const held of [true, false]) {
        request.mockRejectedValueOnce(gqlError('SUBSCRIBE_FORBIDDEN', 'x', { held }));
        messages.push(refusalOf(await run('subscribe', { worker: 'w-2' })).message);
      }
      expect(messages[0]).not.toBe(messages[1]);
    });

    it('a crafted POST naming a retired worker with authority gets WORKER_RETIRED as fixed copy', async () => {
      request.mockRejectedValueOnce(gqlError('WORKER_RETIRED', 'A retired worker cannot be subscribed.'));
      const r = (await run('subscribe', { worker: 'w-retired' })) as { status: number };
      expect(r.status).toBe(409);
      expect(refusalOf(r)).toMatchObject({ kind: 'refused', code: 'WORKER_RETIRED' });
      expect(refusalOf(r).message).not.toContain('cannot be subscribed'); // the server's own wording is not the portal's
    });

    it('a FAILED announcement is flagged in the result; a POSTED one is not', async () => {
      request.mockResolvedValueOnce({ subscribeWorker: { announcement: 'FAILED', subscription: { id: 's1', endedAt: null } } });
      const flagged = await run('subscribe', { worker: 'w-2' });
      request.mockResolvedValueOnce({ subscribeWorker: { announcement: 'POSTED', subscription: { id: 's2', endedAt: null } } });
      const quiet = await run('subscribe', { worker: 'w-2' });
      expect(flagged).toMatchObject({ announcementFailed: true });
      expect(quiet).not.toHaveProperty('announcementFailed', true);
    });

    it.each([
      ['missing', {}],
      ['repeated', { worker: ['w-1', 'w-2'] }],
      ['empty', { worker: '' }],
      ['over-long', { worker: 'w'.repeat(600) }],
      ['bad charset', { worker: 'w 1<script>' }],
    ])('a %s worker value is invalid and sends nothing', async (_label, fields) => {
      const r = (await run('subscribe', fields)) as { status: number };
      expect(r.status).toBe(400);
      expect(refusalOf(r).kind).toBe('invalid');
      expect(request).not.toHaveBeenCalled();
    });
  });

  describe('unsubscribe', () => {
    it('an ended subscription is a success naming the target', async () => {
      request.mockResolvedValue({ unsubscribeWorker: { announcement: null, subscription: { id: 's1', endedAt: '2026-10-31T00:00:00Z' } } });
      const r = await run('unsubscribe', { worker: 'w-2' });
      expect(request).toHaveBeenCalledWith(UNSUBSCRIBE_WORKER_MUTATION, { tickerRef: 'tk-1', workerRef: 'w-2' });
      expect(r).toMatchObject({ action: 'unsubscribe', ok: true, target: 'w-2' });
    });

    it('a subscription that is somehow still live is not a success', async () => {
      request.mockResolvedValue({ unsubscribeWorker: { announcement: null, subscription: { id: 's1', endedAt: null } } });
      const r = (await run('unsubscribe', { worker: 'w-2' })) as { status: number };
      expect(r.status).toBe(502);
      expect(refusalOf(r).kind).toBe('uncertain');
    });

    it('a stale row WITH authority: SUBSCRIPTION_NOT_FOUND, fixed "No longer subscribed" copy', async () => {
      request.mockRejectedValueOnce(gqlError('SUBSCRIPTION_NOT_FOUND', 'That worker is not subscribed to this ticker.'));
      const r = (await run('unsubscribe', { worker: 'w-2' })) as { status: number };
      expect(r.status).toBe(404);
      expect(refusalOf(r)).toMatchObject({ kind: 'refused', code: 'SUBSCRIPTION_NOT_FOUND' });
      expect(refusalOf(r).message).toContain('No longer subscribed');
      expect(refusalOf(r).message).not.toContain('That worker is not subscribed');
    });

    it('a stale row WITHOUT authority: SUBSCRIBE_FORBIDDEN even though nothing is live', async () => {
      request.mockRejectedValueOnce(gqlError('SUBSCRIBE_FORBIDDEN', 'x', { held: true }));
      const r = (await run('unsubscribe', { worker: 'w-2' })) as { status: number };
      expect(refusalOf(r)).toMatchObject({ kind: 'refused', code: 'SUBSCRIBE_FORBIDDEN' });
    });
  });

  describe('the one not-available sentence', () => {
    it.each(['TICKER_NOT_FOUND', 'WORKER_NOT_FOUND', 'APP_NOT_FOUND'] as const)('%s renders the identical sentence, with no probe to tell them apart', async (code) => {
      request.mockRejectedValueOnce(gqlError(code, 'server prose'));
      const r = (await run('unsubscribe', { worker: 'w-2' })) as { status: number };
      expect(refusalOf(r).message).toBe(NOT_AVAILABLE);
      expect(refusalOf(r).message).not.toContain('server prose');
      // The route check is the only read; the refusal came from the one mutation.
      expect(request).toHaveBeenCalledTimes(1);
    });
  });

  describe('impersonation', () => {
    it.each(['set-enabled', 'subscribe', 'unsubscribe'] as const)('%s refuses before any request, sending zero mutations', async (name) => {
      const fields: Record<string, string | string[]> = name === 'set-enabled' ? { enabled: 'false' } : { worker: 'w-2' };
      const r = (await run(name, fields, imp)) as { status: number; data: { refusal: { message: string } } };
      expect(r.status).toBe(403);
      expect(r.data.refusal.message).toBe('Impersonation sessions are read-only.');
      expect(loadTicker).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
    });
  });
});
