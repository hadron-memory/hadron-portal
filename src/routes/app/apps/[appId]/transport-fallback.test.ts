/**
 * portal#1788 — the helper-backed App action error sinks answer a plain
 * transport failure (a bare `Error('fetch failed')`) with their own reader copy,
 * never the library's message. The real action handlers run; only the GraphQL
 * client is faked. Typed refusal maps, status routing and no-retry stay as they
 * were. Reproduced paths: updateAgentTools, createKey, revokeKey (Gaia, #1787
 * LOCAL). Source-only until this test reproduced them: saveTaskIntegrations,
 * the three Channels actions, run cancel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
});

const transport = () => new Error('fetch failed');
const typed = (code: string, message = 'server prose') =>
  new ClientError(
    { data: null, errors: [{ message, extensions: { code } }], status: 200, headers: new Headers() } as unknown as ConstructorParameters<typeof ClientError>[0],
    { query: '', variables: {} },
  );
const post = (fields: Record<string, string | string[]>) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return new Request('http://localhost/', { method: 'POST', body });
};
type Answer = { status?: number; data?: { form: { message?: { text: string } } }; form?: { message?: { text: string } } };
const textOf = (r: unknown) => {
  const a = r as Answer;
  return (a.data?.form ?? a.form)?.message?.text;
};
const statusOf = (r: unknown) => (r as Answer).status;

describe('App page actions', () => {
  const cases = [
    ['updateAgentTools', { _kind: 'updateAgentTools' }, 'Failed to update agent tools'],
    ['createKey', { _kind: 'createKey', label: 'k' }, 'Failed to create key'],
    ['revokeKey', { _kind: 'revokeKey', keyId: 'key-1' }, 'Failed to revoke key'],
  ] as const;
  for (const [name, fields, fallback] of cases) {
    it(`${name}: a transport failure returns the fallback, once, as a 500`, async () => {
      const { actions } = await import('./+page.server');
      mockRequest.mockRejectedValueOnce(transport());
      const r = await actions[name]({ request: post(fields), params: { appId: 'app-1' }, locals: { token: 'tok' } } as never);
      expect(textOf(r)).toBe(fallback);
      expect(statusOf(r)).toBe(500);
      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
    it(`${name}: typed refusals keep their routing`, async () => {
      const { actions } = await import('./+page.server');
      mockRequest.mockRejectedValueOnce(typed('FORBIDDEN'));
      const forbidden = await actions[name]({ request: post(fields), params: { appId: 'app-1' }, locals: { token: 'tok' } } as never);
      expect(statusOf(forbidden)).toBe(403);
      mockRequest.mockRejectedValueOnce(typed('IMPERSONATION_READ_ONLY'));
      const imp = await actions[name]({ request: post(fields), params: { appId: 'app-1' }, locals: { token: 'tok' } } as never);
      expect(statusOf(imp)).toBe(403);
      expect(textOf(imp)).not.toBe(textOf(forbidden));
    });
  }
});

describe('POST /api/create-app-key', () => {
  it('a transport failure answers the fallback with 500', async () => {
    const { POST } = await import('../../../api/create-app-key/+server');
    mockRequest.mockRejectedValueOnce(transport());
    const res = await POST({ request: new Request('http://localhost/', { method: 'POST', body: JSON.stringify({ appId: 'app-1' }) }), locals: { token: 'tok' } } as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to create app key' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe('saveTaskIntegrations', () => {
  it('a transport failure on the write returns the save-failed copy, with no second write', async () => {
    const { saveTaskIntegrations } = await import('$lib/server/app-properties');
    const { APP_PROPERTIES_QUERY } = await import('$lib/server/queries');
    const request = vi.fn(async (doc: string) => {
      if (doc === APP_PROPERTIES_QUERY) return { app: { id: 'a', properties: { taskIntegrations: [] }, propertiesRevision: 3 } };
      throw transport();
    });
    const body = new FormData();
    body.set('integrations', '[]');
    body.set('revision', '3');
    const r = await saveTaskIntegrations({ request } as never, 'a', body);
    expect(r).toMatchObject({ ok: false, message: 'The settings could not be saved.' });
    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe('Channels actions', () => {
  const cases = [
    ['createChannel', { _kind: 'createChannel', name: 'Ops', slug: 'ops' }, 'The channel could not be created.'],
    ['renameChannel', { _kind: 'renameChannel', ref: 'r', name: 'Ops' }, 'The channel could not be renamed.'],
    ['deleteChannel', { _kind: 'deleteChannel', ref: 'r' }, 'The channel could not be deleted.'],
  ] as const;
  for (const [name, fields, fallback] of cases) {
    it(`${name}: a transport failure returns the fallback`, async () => {
      const { actions } = await import('./channels/+page.server');
      mockRequest.mockRejectedValueOnce(transport());
      const r = await actions[name]({ request: post(fields), params: { appId: 'app-1' }, locals: { token: 'tok' } } as never);
      expect(textOf(r)).toBe(fallback);
    });
  }
  it('typed NOT_FOUND keeps its own copy', async () => {
    const { actions } = await import('./channels/+page.server');
    mockRequest.mockRejectedValueOnce(typed('NOT_FOUND'));
    const r = await actions.deleteChannel({ request: post({ _kind: 'deleteChannel', ref: 'r' }), params: { appId: 'app-1' }, locals: { token: 'tok' } } as never);
    expect(textOf(r)).toBe('That channel or its memory is not available to you.');
  });
});

describe('run cancel', () => {
  it('a transport failure returns the fallback as a 500', async () => {
    const { actions } = await import('./runs/[runId]/+page.server');
    mockRequest.mockRejectedValueOnce(transport());
    const r = await actions.cancel({ request: post({ _kind: 'cancelRun' }), params: { appId: 'app-1', runId: 'run-1' }, locals: { token: 'tok' } } as never);
    expect(textOf(r)).toBe('Failed to cancel run');
    expect(statusOf(r)).toBe(500);
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
