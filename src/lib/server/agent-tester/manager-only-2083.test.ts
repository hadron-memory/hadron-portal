/**
 * portal#2083 — the Agent Tester is manager-only.
 *
 * After hadron-server#4095, `startChat` refuses a member who cannot manage the
 * Agent unless a licensed App chat home admits them. The Tester has no such
 * home, so offering it to every org member (READER, CONTRIBUTOR) hands them a
 * run the server then refuses. The Tester now admits only a principal the
 * server's own `effectiveAccess.canManage` names, and the server stays
 * authoritative on every start.
 *
 * Six entry points reach the Tester: the Agent page's "Open Tester" link
 * (pinned in the page's own test), the Tester page load, the fixtures
 * GET/POST/DELETE, the fixtures run, the direct test-run and the scripted
 * persona run (test-persona, found by Glen's LOCAL review of this PR). Each is pinned
 * here for the same matrix: a non-manager is concealed as not-found with no AI
 * resolution and no startChat; a manager is admitted; a failed manage read is
 * an error, never a 404 and never admission.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CREATE_NODE_MUTATION,
  FIXTURE_NODES_QUERY,
  MY_AGENTS_QUERY,
  NODE_QUERY,
  ORGANIZATIONS_QUERY,
  SELF_CAN_MANAGE_QUERY,
  START_CHAT_MUTATION,
} from '$lib/server/queries';
import { __resetRateLimit } from '$lib/server/rate-limit';
import { CHAT_ERROR } from '$lib/server/llm/chatError';

const mockRequest = vi.fn();
const mockResolveChatAi = vi.fn();
const mockRunChatTurn = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/llm/chatAi.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/llm/chatAi.js')>()),
  resolveChatAi: (...args: unknown[]) => mockResolveChatAi(...args),
}));
vi.mock('$lib/server/llm/agentChatTurn.js', () => ({
  runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
}));

const AGENT_ID = 'agent-aaa';
const AGENT_URN = 'hrn:agent:hadronmemory.com:aaa';
const USER_ID = 'user-1';

type Who = 'manager' | 'non-manager' | 'null-answer' | 'manage-read-fails';
type Placement = 'org' | 'personal';

/** One agent the caller can see, plus the server's answer to "may they manage it?". */
function route(who: Who, placement: Placement = 'org') {
  const agent = { id: AGENT_ID, urn: AGENT_URN, name: 'A', organizationId: placement === 'org' ? 'org-a' : null, systemMemoryId: 'sys-mem-a' };
  mockRequest.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
    if (query === ORGANIZATIONS_QUERY) {
      return { organizations: { items: placement === 'org' ? [{ id: 'org-a', name: 'Org', urn: 'hrn:org:a', agents: [agent] }] : [], total: placement === 'org' ? 1 : 0 } };
    }
    if (query === MY_AGENTS_QUERY) {
      return { agents: { items: placement === 'personal' ? [agent] : [], total: placement === 'personal' ? 1 : 0 } };
    }
    if (query === SELF_CAN_MANAGE_QUERY) {
      expect(vars).toMatchObject({ user: USER_ID, resource: AGENT_URN });
      if (who === 'manage-read-fails') throw new Error('upstream 503');
      // A null answer is neither yes nor no: the resolver fails closed.
      if (who === 'null-answer') return { effectiveAccess: null };
      return { effectiveAccess: { canManage: who === 'manager' } };
    }
    if (query === FIXTURE_NODES_QUERY) return { findNodes: { hits: [] } };
    if (query === NODE_QUERY) return { node: null };
    if (query === CREATE_NODE_MUTATION) return { createNode: { id: 'n1', loc: 'fixtures:n1' } };
    if (query === START_CHAT_MUTATION) throw new Error('startChat must not be reached');
    throw new Error(`Unexpected query: ${query.slice(0, 50)}`);
  });
}

function startChatCalls() {
  return mockRequest.mock.calls.filter(([q]) => q === START_CHAT_MUTATION).length;
}

/** Status a handler answered with, or 'threw' when the failure propagated. */
async function status(run: () => Promise<Response>): Promise<number | 'threw'> {
  try {
    return (await run()).status;
  } catch {
    return 'threw';
  }
}

/** The exact concealed-miss body. Fixtures run's ADMITTED outcome is also a 404 ('No fixtures to run'), so a bare status cannot tell denial from admission (§10 P2, #2103). */
async function expectConcealedMiss(call: () => Promise<Response>) {
  const res = await call();
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: 'Agent not found or no longer available' });
}

const locals = (user: { id: string } | null = { id: USER_ID }) => ({ token: 'tok', user });

function jsonReq(url: string, method: string, body?: unknown) {
  return new Request(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify({ appId: 'app-1', ...(body as object) }),
  });
}

/** What "admitted" looks like past the gate, per surface, so a post-read crash cannot pass for admission. */
/**
 * portal#2099: how a failed lookup or manage read leaves each handler TODAY.
 * 'propagates' = the injected error escapes unchanged; 'mapped' = publicChatError
 * catches it and the wire is status 500 with `{ error: CHAT_ERROR.failed, code: 'failed' }`
 * (the wire field is `error`, not `message`).
 */
type FailureShape = 'propagates' | 'mapped';

const surfaces: Array<{ name: string; failure: FailureShape; call: (l: ReturnType<typeof locals>) => Promise<Response>; admitted: (res: Response) => Promise<void> }> = [
  {
    name: 'fixtures GET',
    failure: 'propagates',
    call: async (l) => {
      const { GET } = await import('../../../routes/api/agent-chat/fixtures/+server');
      const url = new URL(`http://test/api/agent-chat/fixtures?agentId=${AGENT_ID}`);
      return GET({ url, request: new Request(url), locals: l } as never);
    },
    admitted: async (res) => { expect(res.status).toBe(200) },
  },
  {
    name: 'fixtures POST',
    failure: 'propagates',
    call: async (l) => {
      const { POST } = await import('../../../routes/api/agent-chat/fixtures/+server');
      const url = new URL('http://test/api/agent-chat/fixtures');
      return POST({ url, request: jsonReq(url.href, 'POST', { agentId: AGENT_ID, label: 'x', turn: { user: 'hi', persona: null, assertion: null } }), locals: l } as never);
    },
    admitted: async (res) => { expect(res.status).toBeLessThan(300); expect((await res.json()).fixtureId).toBe('n1') },
  },
  {
    name: 'fixtures DELETE',
    failure: 'propagates',
    call: async (l) => {
      const { DELETE } = await import('../../../routes/api/agent-chat/fixtures/+server');
      const url = new URL(`http://test/api/agent-chat/fixtures?agentId=${AGENT_ID}&fixtureLoc=fixtures:abc`);
      return DELETE({ url, request: jsonReq(url.href, 'DELETE', { agentId: AGENT_ID, fixtureLoc: 'fixtures:abc' }), locals: l } as never);
    },
    admitted: async (res) => { expect(res.status).toBe(204) },
  },
  {
    name: 'fixtures run',
    failure: 'propagates',
    call: async (l) => {
      const { POST } = await import('../../../routes/api/agent-chat/fixtures/run/+server');
      const url = new URL('http://test/api/agent-chat/fixtures/run');
      return POST({ url, request: jsonReq(url.href, 'POST', { agentId: AGENT_ID }), locals: l } as never);
    },
    admitted: async (res) => { expect(res.status).toBe(404); expect((await res.json()).error).toBe('No fixtures to run') },
  },
  {
    name: 'direct test-run',
    failure: 'mapped',
    call: async (l) => {
      const { POST } = await import('../../../routes/api/agent-chat/test-run/+server');
      const url = new URL('http://test/api/agent-chat/test-run');
      return POST({ url, request: jsonReq(url.href, 'POST', { agentId: AGENT_ID, message: 'hello' }), locals: l } as never);
    },
    admitted: async () => { expect(mockResolveChatAi).toHaveBeenCalledTimes(1) },
  },
  {
    name: 'scripted persona run (test-persona)',
    failure: 'mapped',
    call: async (l) => {
      const { POST } = await import('../../../routes/api/agent-chat/test-persona/+server');
      const url = new URL('http://test/api/agent-chat/test-persona');
      return POST({ url, request: jsonReq(url.href, 'POST', { agentId: AGENT_ID, personaName: 'P', openingMessage: 'hi', followUpMessages: [] }), locals: l } as never);
    },
    admitted: async () => { expect(mockResolveChatAi).toHaveBeenCalledTimes(1); },
  },
];

beforeEach(() => {
  mockRequest.mockReset();
  mockResolveChatAi.mockReset();
  mockRunChatTurn.mockReset();
  mockResolveChatAi.mockResolvedValue({ provider: 'anthropic', apiKey: 'sk', model: 'm' });
  __resetRateLimit();
});

describe.each(surfaces)('$name', ({ call, admitted, failure }) => {
  it('conceals the Tester from a non-manager (READER/CONTRIBUTOR) and never starts a chat', async () => {
    route('non-manager');
    await expectConcealedMiss(() => call(locals()));
    expect(mockResolveChatAi).not.toHaveBeenCalled();
    expect(mockRunChatTurn).not.toHaveBeenCalled();
    expect(startChatCalls()).toBe(0);
  });

  it('fails closed on a null effectiveAccess answer: concealed, never admitted', async () => {
    route('null-answer');
    await expectConcealedMiss(() => call(locals()));
    expect(mockResolveChatAi).not.toHaveBeenCalled();
    expect(startChatCalls()).toBe(0);
  });

  it('conceals it from a non-manager on a user-owned Agent path too', async () => {
    route('non-manager', 'personal');
    await expectConcealedMiss(() => call(locals()));
    expect(mockResolveChatAi).not.toHaveBeenCalled();
    expect(startChatCalls()).toBe(0);
  });

  it('treats a missing user as not-found, not as admission', async () => {
    route('manager');
    await expectConcealedMiss(() => call(locals(null)));
    expect(mockResolveChatAi).not.toHaveBeenCalled();
  });

  it('turns a failed manage read into an error: never a 404, never admission', async () => {
    route('manage-read-fails');
    const s = await status(() => call(locals()));
    expect(s).not.toBe(404);
    expect(s === 'threw' || s >= 500).toBe(true);
    expect(mockResolveChatAi).not.toHaveBeenCalled();
    expect(startChatCalls()).toBe(0);
  });

  it('leaves a failed manage read exactly as today: the injected error, or the mapped 500', async () => {
    route('manage-read-fails');
    if (failure === 'propagates') {
      await expect(call(locals())).rejects.toThrow('upstream 503');
    } else {
      const res = await call(locals());
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: CHAT_ERROR.failed, code: 'failed' });
    }
  });

  it.each([['org' as const], ['personal' as const]])('admits a manager (%s placement): not concealed', async (placement) => {
    route('manager', placement);
    mockResolveChatAi.mockRejectedValue(new Error('stop after admission'));
    await admitted(await call(locals()));
    // Admission means the manage check ran and said yes, not that it was skipped.
    expect(mockRequest.mock.calls.some(([q]) => q === SELF_CAN_MANAGE_QUERY)).toBe(true);
  });
});

describe('Tester page load', () => {
  async function load(l: ReturnType<typeof locals>) {
    const mod = await import('../../../routes/app/agents/[id]/test/+page.server');
    return mod.load({ params: { id: AGENT_ID }, locals: l, parent: async () => ({ isConsumerMode: false }), url: new URL(`http://test/app/agents/${AGENT_ID}/test`) } as never);
  }

  it('answers a non-manager with the existing 404', async () => {
    route('non-manager');
    await expect(load(locals())).rejects.toMatchObject({ status: 404 });
  });

  it('answers a null effectiveAccess with the existing 404', async () => {
    route('null-answer');
    await expect(load(locals())).rejects.toMatchObject({ status: 404 });
  });

  it('answers a missing user with the existing 404', async () => {
    route('manager');
    await expect(load(locals(null))).rejects.toMatchObject({ status: 404 });
  });

  it.each([['org' as const], ['personal' as const]])('admits a manager (%s placement) with the agent in the result', async (placement) => {
    route('manager', placement);
    const data = (await load(locals())) as unknown as { agent: Record<string, unknown> };
    expect(data.agent).toMatchObject({ id: AGENT_ID, systemMemoryId: 'sys-mem-a' });
  });

  // portal#2099 item 4 (a RESPONSE CHANGE): every lookup failure on the page load is
  // one fixed, localized Tester 500. It never carries server text, is never a 404,
  // and never admits. Flips the baseline commit's propagation pin.
  it.each([
    ['organization list', ORGANIZATIONS_QUERY],
    ['ownedByMe list', MY_AGENTS_QUERY],
    ['manage read', SELF_CAN_MANAGE_QUERY],
  ])('a failed %s answers the fixed Tester 500, with no upstream text', async (_name, failing) => {
    route('manager', 'personal');
    const routed = mockRequest.getMockImplementation();
    expect(routed).toBeTypeOf('function');
    if (!routed) return;
    mockRequest.mockImplementation(async (q: string, v?: Record<string, unknown>) => {
      if (q === failing) throw new Error('upstream 503');
      return routed(q, v);
    });
    const err = (await load(locals()).then(() => null, (e: unknown) => e)) as { status?: number; body?: { message?: string } } | null;
    expect(err).not.toBeNull();
    expect(err!.status).toBe(500);
    expect(err!.body?.message).toBe('The Agent Tester could not be loaded. Please try again.');
    expect(JSON.stringify(err)).not.toContain('upstream 503');
    expect(mockResolveChatAi).not.toHaveBeenCalled();
    expect(startChatCalls()).toBe(0);
  });

  // portal#2106 row 5: the log names the error's class when the server gave no
  // code, and never carries the message (graphql-request packs the request in it).
  describe('the lookup-failure log', () => {
    const failWith = async (err: unknown) => {
      route('manager', 'personal');
      const routed = mockRequest.getMockImplementation();
      expect(routed).toBeTypeOf('function');
      mockRequest.mockImplementation(async (q: string, v?: Record<string, unknown>) => {
        if (q === ORGANIZATIONS_QUERY) throw err;
        return routed!(q, v);
      });
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await load(locals()).catch(() => null);
        return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      } finally {
        spy.mockRestore();
      }
    };

    it('logs TypeError for a non-GraphQL failure, never its message', async () => {
      const logged = await failWith(new TypeError('INJECTED-SECRET-REQUEST-BODY'));
      expect(logged).toContain('TypeError');
      expect(logged).not.toContain('INJECTED-SECRET-REQUEST-BODY');
      expect(logged).not.toContain('no code');
    });

    it('never logs a sensitive Error.name: a fixed label instead', async () => {
      const bad = Object.assign(new Error('INJECTED-SECRET-MESSAGE'), { name: 'INJECTED-SECRET-NAME' });
      const logged = await failWith(bad);
      expect(logged).not.toContain('INJECTED-SECRET');
      expect(logged).toContain('Error');
      const sub = Object.assign(new TypeError('INJECTED-SECRET-MESSAGE'), { name: 'INJECTED-SECRET-NAME' });
      const loggedSub = await failWith(sub);
      expect(loggedSub).toContain('TypeError');
      expect(loggedSub).not.toContain('INJECTED-SECRET');
    });

    it('still logs the GraphQL error code', async () => {
      const gql = Object.assign(new Error('INJECTED-SECRET-REQUEST-BODY'), {
        response: { errors: [{ message: 'INJECTED-SECRET-REQUEST-BODY', extensions: { code: 'FORBIDDEN' } }] },
      });
      const logged = await failWith(gql);
      expect(logged).toContain('FORBIDDEN');
      expect(logged).not.toContain('INJECTED-SECRET-REQUEST-BODY');
    });
  });
});
