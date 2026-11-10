/**
 * portal#1538 (hadron-server#2458 S4; hrn:node:hadronmemory.com:specs:cor:dmo:050:11) — the worker page's
 * `changeWorkerAgent` action and the loader's gate for offering it.
 * The server decides who may; the portal only shapes the call and each refusal.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGE_WORKER_AGENT_MUTATION } from '$lib/server/queries';

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
type Out = { status?: number; data?: { changeAgent: Record<string, any> }; changeAgent?: Record<string, any> };
const run = async (event = actionEvent({ id: 'w-1' }, { agentId: 'a-2' })) => {
  const { actions } = await import('./+page.server');
  return actions.changeWorkerAgent!(event) as Promise<Out>;
};

describe('changeWorkerAgent: the call', () => {
  it('sends the route’s worker and the chosen Agent’s id, whatever else the form posts', async () => {
    mockRequest.mockResolvedValue({ changeWorkerAgent: { id: 'w-1', role: 'reviewer', agent: { id: 'a-2', name: 'Reviewer' } } });
    await run(actionEvent({ id: 'w-1' }, { agentId: 'a-2', workerRef: 'w-OTHER', worker: 'w-OTHER' }));
    expect(mockRequest.mock.calls).toEqual([[CHANGE_WORKER_AGENT_MUTATION, { workerRef: 'w-1', agentRef: 'a-2' }]]);
  });

  it('returns the new Agent and role keyed to the worker', async () => {
    mockRequest.mockResolvedValue({ changeWorkerAgent: { id: 'w-1', role: 'reviewer', agent: { id: 'a-2', name: 'Reviewer' } } });
    expect(await run()).toEqual({ changeAgent: { key: 'w-1', ok: true, agentName: 'Reviewer', role: 'reviewer' } });
  });

  it('sends nothing when no Agent was chosen', async () => {
    const r = await run(actionEvent({ id: 'w-1' }, { agentId: '  ' }));
    expect(mockRequest).not.toHaveBeenCalled();
    expect(r.status).toBe(400);
    expect(r.data!.changeAgent.refusal.message).toMatch(/choose/i);
  });
});

describe('changeWorkerAgent: each refusal in plain words, local to the result', () => {
  const cases: Array<[string, RegExp]> = [
    ['WORKER_AGENT_NOT_INSTALLED', /isn.t installed/i],
    ['AGENT_ORG_GRANT_INACTIVE', /inactive grant/i],
    ['AGENT_ORG_GRANT_REQUIRED', /grant/i],
    ['BOOT_PROMPT_GRANT_REQUIRED', /boot prompt/i],
    ['BOOT_PROMPT_INCLUDE_UNAVAILABLE', /boot prompt/i],
    ['APP_UNINSTALLED', /uninstalled/i],
    ['WORKER_RETIRED', /retired/i],
    ['WORKER_AGENT_UNCHANGED', /already/i],
    ['WORKER_AGENT_HAS_NO_ROLE', /no role/i],
    ['WORKER_CASTING_STALE', /at the same time.*reload/i],
    ['FORBIDDEN', /can.t change this worker.s agent from this sign-in/i],
  ];
  it.each(cases)('%s shows its own message, not the raw code', async (code, re) => {
    mockRequest.mockRejectedValue(gqlError(code));
    const r = await run();
    const a = r.data!.changeAgent;
    expect(a.key).toBe('w-1');
    expect(a.refusal.code).toBe(code);
    expect(a.refusal.message).toMatch(re);
    expect(a.refusal.message).not.toContain(code);
    expect(a.refusal.outcomeUnknown).toBe(false);
  });

  it('inactive grant names no unavailable remedy and stays a definite 409', async () => {
    mockRequest.mockRejectedValue(gqlError('AGENT_ORG_GRANT_INACTIVE'));
    const r = await run();
    expect(r.status).toBe(409);
    expect(r.data!.changeAgent.refusal).toEqual({
      code: 'AGENT_ORG_GRANT_INACTIVE', outcomeUnknown: false,
      message: 'This App’s organization has an inactive grant for that agent, so it can’t be used.',
    });
  });

  // portal#1813 (hadron-server#3626): the personal App's owner no longer
  // qualifies for its ORGANIZATION-visible Agent. That is a definite refusal,
  // so it must not fall to the default's 502 "couldn't tell whether this
  // worked". Same first sentence as #1786's chat copy, with this surface's
  // action noun; no route back and no retry.
  it('BOOT_PROMPT_INSTALL_LICENSE_INACTIVE is a definite 409 with its fixed copy', async () => {
    const warn = vi.mocked(console.warn);
    mockRequest.mockRejectedValue(gqlError('BOOT_PROMPT_INSTALL_LICENSE_INACTIVE'));
    const r = await run();
    expect(r.status).toBe(409);
    expect(r.data!.changeAgent).toEqual({
      key: 'w-1',
      refusal: {
        code: 'BOOT_PROMPT_INSTALL_LICENSE_INACTIVE',
        outcomeUnknown: false,
        message: 'The owner of this App no longer qualifies to use this organization Agent, so the agent can’t be changed. Trying again won’t help.',
      },
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('FORBIDDEN does not read as "you do not manage this App"', async () => {
    mockRequest.mockRejectedValue(gqlError('FORBIDDEN'));
    expect((await run()).data!.changeAgent.refusal.message).not.toMatch(/manage/i);
  });

  it('an unrecognised failure is outcome-unknown: no retry, tells the reader to reload', async () => {
    mockRequest.mockRejectedValue(gqlError('SOMETHING_NEW'));
    const r = await run();
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(r.data!.changeAgent.refusal.outcomeUnknown).toBe(true);
    expect(r.data!.changeAgent.refusal.message).toMatch(/reload/i);
  });

  it('a non-GraphQL failure is outcome-unknown too', async () => {
    mockRequest.mockRejectedValue(new Error('socket hang up'));
    expect((await run()).data!.changeAgent.refusal.outcomeUnknown).toBe(true);
  });
});

describe('loader: who is offered the control', () => {
  const WORKER = {
    hasLiveSession: false, id: 'w-1', appId: 'app-1', agentId: 'a-1', name: 'Gil', slug: 'gil',
    urn: 'hrn:worker:x:team:gil', role: 'engineer', memoryId: 'm', retiredAt: null,
    agent: { id: 'a-1', name: 'Engineer', urn: 'hrn:agent:x:engineer' },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team' },
  };
  const INSTALLED = [
    { agent: { id: 'a-1', name: 'Engineer', urn: 'hrn:agent:x:engineer', personaRole: 'engineer' } },
    { agent: { id: 'a-2', name: 'Reviewer', urn: 'hrn:agent:x:reviewer', personaRole: 'reviewer' } },
    { agent: { id: 'a-3', name: 'Team def', urn: 'hrn:agent:x:team', personaRole: null } },
  ];
  function wire(canManage: boolean) {
    mockRequest.mockImplementation(async (q: string) => {
      if (q.includes('query Worker(')) return { worker: WORKER };
      if (q.includes('query SelfCanManage')) return { effectiveAccess: { canManage } };
      if (q.includes('appAgents')) return { app: { id: 'app-1', appAgents: INSTALLED } };
      return { sessions: [], teamWorkItems: { items: [], total: 0 }, worker: null };
    });
  }
  async function load(impersonation: unknown = null) {
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: 'w-1' },
      url: new URL('http://localhost/app/workers/w-1'),
      locals: { user: { id: 'u1' }, token: 'tok', impersonation },
    } as never)) as Record<string, any>;
  }

  it('a manager acting as themselves gets the control and the installed, castable, other Agents', async () => {
    wire(true);
    const d = await load();
    expect(d.canChangeAgent).toBe(true);
    expect(d.changeAgentOptions.map((a: { id: string }) => a.id)).toEqual(['a-2']);
  });

  it('a viewer who does not manage the App gets no control and no roster read', async () => {
    wire(false);
    const d = await load();
    expect(d.canChangeAgent).toBe(false);
    expect(d.changeAgentOptions).toEqual([]);
    expect(mockRequest.mock.calls.some((c) => String(c[0]).includes('appAgents'))).toBe(false);
  });

  it('a roster read that fails is an unavailable state (null), never an empty roster', async () => {
    mockRequest.mockImplementation(async (q: string) => {
      if (q.includes('query Worker(')) return { worker: WORKER };
      if (q.includes('query SelfCanManage')) return { effectiveAccess: { canManage: true } };
      if (q.includes('appAgents')) throw new Error('roster unavailable');
      return { sessions: [], teamWorkItems: { items: [], total: 0 }, worker: null };
    });
    const d = await load();
    expect(d.canChangeAgent).toBe(true);
    expect(d.changeAgentOptions).toBeNull();
  });

  it('an impersonating admin gets no control even where the manage check says yes', async () => {
    wire(true);
    const d = await load({ sessionId: 's', actorUserId: 'admin', orgId: 'o', expiresAt: Date.now() + 1000 });
    expect(d.canChangeAgent).toBe(false);
    expect(d.changeAgentOptions).toEqual([]);
  });
});
