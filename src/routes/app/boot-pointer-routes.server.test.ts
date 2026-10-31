/**
 * portal#1142 S8 — the three pages' pointer actions and loader joins
 * (hadron-server#2219; Xylon's stamp 6330444824): each action sends exactly
 * its setter's variables (an explicit null to clear), keyed to its surface;
 * the worker page asks the worker's APP audit and never the worker's holder.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SELF_CAN_MANAGE_QUERY,
  SET_AGENT_BOOT_PROMPT_MUTATION,
  SET_APP_AGENT_BOOT_PROMPT_MUTATION,
  SET_WORKER_BOOT_PROMPT_MUTATION,
  WORKER_BOOT_POINTER_QUERY,
  WORKER_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: (...a: unknown[]) => mockRequest(...a) }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

function actionEvent(params: Record<string, string>, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return { request: { formData: async () => fd }, params, locals: { token: 'tok', user: { id: 'u1' } } } as never;
}
const callsTo = (doc: string) => mockRequest.mock.calls.filter(([q]) => q === doc).map(([, v]) => v);

describe('Agent page: setBootPrompt', () => {
  it('sends agentRef and the typed nodeRef, then an explicit null to clear', async () => {
    const { actions } = await import('./agents/[id]/+page.server');
    expect(await actions.setBootPrompt!(actionEvent({ id: 'agent-1' }, { intent: 'set', nodeRef: ' hrn:node:a.com:sys:boot ' }))).toEqual({ pointer: { key: 'agent-1', ok: true, cleared: false } });
    expect(await actions.setBootPrompt!(actionEvent({ id: 'agent-1' }, { intent: 'clear', nodeRef: 'ignored' }))).toEqual({ pointer: { key: 'agent-1', ok: true, cleared: true } });
    expect(callsTo(SET_AGENT_BOOT_PROMPT_MUTATION)).toEqual([
      { agentRef: 'agent-1', nodeRef: 'hrn:node:a.com:sys:boot' },
      { agentRef: 'agent-1', nodeRef: null },
    ]);
  });

  it('an empty Set sends no mutation', async () => {
    const { actions } = await import('./agents/[id]/+page.server');
    await actions.setBootPrompt!(actionEvent({ id: 'agent-1' }, { intent: 'set', nodeRef: '' }));
    expect(callsTo(SET_AGENT_BOOT_PROMPT_MUTATION)).toEqual([]);
  });
});

describe('App page: setAppAgentBootPrompt', () => {
  it('sends appRef, the row’s agentRef and nodeRef, keyed to that row', async () => {
    const { actions } = await import('./apps/[appId]/+page.server');
    expect(await actions.setAppAgentBootPrompt!(actionEvent({ appId: 'app-1' }, { agentRef: 'a2', intent: 'set', nodeRef: 'n9' }))).toEqual({ pointer: { key: 'app-1\u0000a2', ok: true, cleared: false } });
    await actions.setAppAgentBootPrompt!(actionEvent({ appId: 'app-1' }, { agentRef: 'a2', intent: 'clear' }));
    expect(callsTo(SET_APP_AGENT_BOOT_PROMPT_MUTATION)).toEqual([
      { appRef: 'app-1', agentRef: 'a2', nodeRef: 'n9' },
      { appRef: 'app-1', agentRef: 'a2', nodeRef: null },
    ]);
  });

  it('a refusal comes back on that row only, with the draft', async () => {
    const { actions } = await import('./apps/[appId]/+page.server');
    mockRequest.mockRejectedValueOnce({ response: { errors: [{ message: 'Only the manager.', extensions: { code: 'FORBIDDEN' } }] } });
    const r = (await actions.setAppAgentBootPrompt!(actionEvent({ appId: 'app-1' }, { agentRef: 'a2', intent: 'set', nodeRef: 'n9' }))) as { status: number; data: { pointer: Record<string, unknown> } };
    expect(r.status).toBe(403);
    expect(r.data.pointer).toMatchObject({ key: 'app-1\u0000a2', nodeRef: 'n9', refusal: { code: 'FORBIDDEN', message: 'Only the manager.' } });
  });
});

describe('Worker page: setBootPrompt and its loader', () => {
  it('sends workerRef and nodeRef, and null to clear', async () => {
    const { actions } = await import('./workers/[id]/+page.server');
    await actions.setBootPrompt!(actionEvent({ id: 'w-1' }, { intent: 'set', nodeRef: 'n1' }));
    await actions.setBootPrompt!(actionEvent({ id: 'w-1' }, { intent: 'clear' }));
    expect(callsTo(SET_WORKER_BOOT_PROMPT_MUTATION)).toEqual([
      { workerRef: 'w-1', nodeRef: 'n1' },
      { workerRef: 'w-1', nodeRef: null },
    ]);
  });

  it('a manager who does not hold the worker gets the form: the audit asks about the worker’s App, never its holder', async () => {
    const worker = { hasLiveSession: false,
      id: 'w-1', appId: 'app-1', agentId: 'a-1', name: 'Gil', slug: 'gil', urn: 'hrn:worker:a.com:team:gil', role: 'eng',
      promptOverride: null, memoryId: 'm', retiredAt: null, createdAt: '2026-10-01T00:00:00Z',
      heldByUserId: 'someone-else', heldByUser: { id: 'someone-else', handle: 'other' },
      agent: { id: 'a-1', name: 'Eng', urn: 'hrn:agent:a.com:eng', personaRole: 'eng' },
      app: { id: 'app-1', name: 'Team', urn: 'hrn:app:a.com:team' },
    };
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === WORKER_QUERY) return { worker };
      if (doc === WORKER_BOOT_POINTER_QUERY) return { worker: { id: 'w-1', bootPromptRef: 'hrn:node:a.com:install:boot', bootPromptTargetDeleted: false } };
      if (doc === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: true } };
      return { sessions: [], teamWorkItems: { items: [], total: 0 } };
    });
    const { load } = await import('./workers/[id]/+page.server');
    const data = (await load({ params: { id: 'w-1' }, url: new URL('http://localhost/app/workers/w-1'), locals: { user: { id: 'u1' }, token: 'tok' } } as never)) as Record<string, unknown>;
    expect(data.bootPointer).toEqual({ ok: true, ref: 'hrn:node:a.com:install:boot', deleted: false });
    expect(data.canManageWorkerApp).toBe(true);
    expect(callsTo(SELF_CAN_MANAGE_QUERY)).toEqual([{ user: 'u1', resource: 'hrn:app:a.com:team' }]);
  });

  it('a failed pointer read is unavailable, not a null pointer', async () => {
    const worker = { hasLiveSession: false, id: 'w-1', urn: 'hrn:worker:a.com:team:gil', name: 'Gil', app: { id: 'app-1', urn: 'hrn:app:a.com:team' } };
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === WORKER_QUERY) return { worker };
      if (doc === WORKER_BOOT_POINTER_QUERY) throw new Error('boom');
      if (doc === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: false } };
      return { sessions: [], teamWorkItems: { items: [], total: 0 } };
    });
    const { load } = await import('./workers/[id]/+page.server');
    const data = (await load({ params: { id: 'w-1' }, url: new URL('http://localhost/app/workers/w-1'), locals: { user: { id: 'u1' }, token: 'tok' } } as never)) as Record<string, unknown>;
    expect(data.bootPointer).toEqual({ ok: false });
    expect(data.canManageWorkerApp).toBe(false);
  });
});
