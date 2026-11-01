/**
 * portal#1462 — the worker page's `applyTickerTemplates` action
 * (hadron-server#2860; hrn:node:hadronmemory.com:hadron-dev-team-victor:drafts:080:080-34).
 * The action asks the server to apply the Agent's ticker templates to the ONE
 * worker the route names. The server decides who may; the portal only shapes
 * the result and the refusal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPLY_AGENT_TICKER_TEMPLATES_MUTATION } from '$lib/server/tickers';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: (...a: unknown[]) => mockRequest(...a) }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function actionEvent(params: Record<string, string>, fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return { request: { formData: async () => fd }, params, locals: { token: 'tok', user: { id: 'u1' } } } as never;
}
const gqlError = (code: string, message = 'server text') => ({ response: { errors: [{ message, extensions: { code } }] } });
const run = async (event = actionEvent({ id: 'w-1' })) => {
  const { actions } = await import('./+page.server');
  return actions.applyTickerTemplates!(event) as Promise<{ status?: number; data?: { applyTickers: Record<string, any> }; applyTickers?: Record<string, any> }>;
};

describe('applyTickerTemplates: the call', () => {
  it('sends exactly the route’s worker, whatever the form posts', async () => {
    mockRequest.mockResolvedValue({ applyAgentTickerTemplates: { created: [], alreadyPresent: [] } });
    await run(actionEvent({ id: 'w-1' }, { workerRef: 'w-OTHER', worker: 'w-OTHER' }));
    expect(mockRequest.mock.calls).toEqual([[APPLY_AGENT_TICKER_TEMPLATES_MUTATION, { workerRef: 'w-1' }]]);
  });

  it('returns the created tickers (with template and effective cadence) and the already-present templates, keyed to the worker', async () => {
    mockRequest.mockResolvedValue({
      applyAgentTickerTemplates: {
        created: [{ effectiveCadenceSeconds: 300, template: { id: 't1', name: 'Heartbeat' }, ticker: { id: 'k1', name: 'Heartbeat · gaby', urn: 'hrn:ticker:a.com:team:heartbeat-gaby' } }],
        alreadyPresent: [{ id: 't2', name: 'Daily digest' }],
      },
    });
    expect(await run()).toEqual({
      applyTickers: {
        key: 'w-1',
        ok: true,
        created: [{ tickerId: 'k1', tickerName: 'Heartbeat · gaby', tickerUrn: 'hrn:ticker:a.com:team:heartbeat-gaby', templateId: 't1', templateName: 'Heartbeat', effectiveCadenceSeconds: 300 }],
        alreadyPresent: [{ id: 't2', name: 'Daily digest' }],
      },
    });
  });

  it('a repeat run is a visible no-op: nothing created, the templates listed', async () => {
    mockRequest.mockResolvedValue({ applyAgentTickerTemplates: { created: [], alreadyPresent: [{ id: 't1', name: 'Heartbeat' }] } });
    expect(await run()).toMatchObject({ applyTickers: { ok: true, created: [], alreadyPresent: [{ id: 't1', name: 'Heartbeat' }] } });
  });
});

describe('applyTickerTemplates: each refusal in plain words, local to the result', () => {
  const cases: Array<[string, number, RegExp, boolean]> = [
    ['FORBIDDEN', 403, /manage/i, false],
    ['WORKER_NOT_FOUND', 404, /worker.*(found|exist)|no longer/i, false],
    ['WORKER_AGENT_NOT_INSTALLED', 400, /agent.*(install)|install/i, false],
    ['TICKER_LIMIT_REACHED', 409, /nothing was created/i, true],
    ['TICKER_NAME_TAKEN', 409, /nothing was created/i, true],
  ];
  it.each(cases)('%s → %i', async (code, status, text, atomic) => {
    mockRequest.mockRejectedValue(gqlError(code));
    const r = await run();
    expect(r.status).toBe(status);
    const a = r.data!.applyTickers;
    expect(a).toMatchObject({ key: 'w-1', refusal: { code } });
    expect(a.ok).toBeUndefined();
    expect(a.refusal.message).toMatch(text);
    // "Nothing was created" is said only where the server guarantees an atomic refusal.
    if (!atomic) expect(a.refusal.message).not.toMatch(/nothing was created/i);
  });

  it('the cap says what to do: raise it or remove tickers', async () => {
    mockRequest.mockRejectedValue(gqlError('TICKER_LIMIT_REACHED'));
    expect((await run()).data!.applyTickers.refusal.message).toMatch(/raise.*(cap|limit)/i);
    expect((await run()).data!.applyTickers.refusal.message).toMatch(/remove/i);
  });

  it('a name clash says what to do: rename or delete the hand-built ticker', async () => {
    mockRequest.mockRejectedValue(gqlError('TICKER_NAME_TAKEN'));
    expect((await run()).data!.applyTickers.refusal.message).toMatch(/rename|delete/i);
  });

  it('a transport failure is outcome-unknown: no "nothing was created", a refresh hint, and exactly one call (no retry)', async () => {
    mockRequest.mockRejectedValue(new Error('socket hang up'));
    const r = await run();
    expect(r.status).toBe(502);
    const a = r.data!.applyTickers;
    expect(a).toMatchObject({ key: 'w-1', refusal: { code: null, outcomeUnknown: true } });
    expect(a.refusal.message).toMatch(/may|might|unknown|couldn.t tell/i);
    expect(a.refusal.message).toMatch(/refresh|reload/i);
    expect(a.refusal.message).not.toMatch(/nothing was created/i);
    expect(a.refusal.message).not.toContain('socket hang up');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('an unrecognised server code is also outcome-unknown, never a false no-write claim', async () => {
    mockRequest.mockRejectedValue(gqlError('INTERNAL_SERVER_ERROR', 'boom'));
    const a = (await run()).data!.applyTickers;
    expect(a.refusal.outcomeUnknown).toBe(true);
    expect(a.refusal.message).not.toMatch(/nothing was created/i);
  });
});
