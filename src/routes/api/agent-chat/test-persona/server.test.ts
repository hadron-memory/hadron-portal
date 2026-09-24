/**
 * #898 — /api/agent-chat/test-persona endpoint tests.
 *
 * The scripted-persona runner is a Tester path, the same as test-run, so it
 * must start its chat with `isTestRun: true`. That flag is what stops the
 * server auto-provisioning an AgentSubscription (spec 019). It was missing
 * here, so running a scripted persona granted the tester a subscription.
 *
 * The portal can only prove the flag is on the wire. hadron-server's
 * resolver tests cover that `isTestRun: true` actually skips the provision.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { START_CHAT_MUTATION } from '$lib/server/queries';
import { __resetRateLimit } from '$lib/server/rate-limit';

const mockRequest = vi.fn();
const mockRunChatTurn = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/llm/agentChatTurn.js', () => ({
  runChatTurn: (...args: unknown[]) => mockRunChatTurn(...args),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRunChatTurn.mockReset();
  // #441's limiter is process-local and this endpoint allows 10/min.
  __resetRateLimit();
});

async function importPOST() {
  const mod = await import('./+server');
  return mod.POST;
}

function ev(opts: { body: unknown; token?: string | null }) {
  return {
    request: new Request('http://test/api/agent-chat/test-persona', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts.body),
    }),
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
  } as Parameters<Awaited<ReturnType<typeof importPOST>>>[0];
}

const turn = (assistantMessage: string) => ({
  assistantMessage,
  stageTransitioned: false,
  newStageName: null,
  conversationHandoff: null,
  chatEnded: false,
  onTrack: true,
});

function mockHappyPath() {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === START_CHAT_MUTATION) {
      return {
        startChat: {
          chatId: 'chat-1',
          systemMessage: 'sys',
          tools: null,
          conversationName: 'setup',
          stageName: 'onboard',
        },
      };
    }
    // Every other call goes through the mocked runChatTurn.
    throw new Error(`Unexpected query: ${query.slice(0, 40)}`);
  });
  mockRunChatTurn.mockImplementation(async () => turn('ok'));
}

const body = {
  agentId: 'agent-1',
  personaName: 'Newcomer',
  openingMessage: 'hello',
  followUpMessages: ['next'],
  conversationName: 'setup',
};

describe('POST /api/agent-chat/test-persona', () => {
  it('starts the chat as a private test run (#898)', async () => {
    mockHappyPath();
    const POST = await importPOST();
    const res = await POST(ev({ body }));
    expect(res.status).toBe(200);

    const startCalls = mockRequest.mock.calls.filter((c) => c[0] === START_CHAT_MUTATION);
    expect(startCalls).toHaveLength(1);
    // Exact equality: a dropped flag fails, and so does an unexpected one.
    expect(startCalls[0][1]).toEqual({
      agentId: 'agent-1',
      conversationName: 'setup',
      scope: 'private',
      isTestRun: true,
    });
  });

  it('still runs the welcome turn plus one turn per scripted message', async () => {
    mockHappyPath();
    const POST = await importPOST();
    const res = await POST(ev({ body }));
    const report = await res.json();

    // welcome + opening + one follow-up
    expect(mockRunChatTurn).toHaveBeenCalledTimes(3);
    expect(mockRunChatTurn.mock.calls.map((c) => (c[0] as { userMessage: string | null }).userMessage))
      .toEqual([null, 'hello', 'next']);
    expect(report.chatId).toBe('chat-1');
    expect(report.personaName).toBe('Newcomer');
    expect(report.pass).toBe(true);
  });

  it('sends a null conversationName when none is given', async () => {
    mockHappyPath();
    const POST = await importPOST();
    await POST(ev({ body: { agentId: 'agent-1', personaName: 'P', openingMessage: 'hi' } }));

    const startCall = mockRequest.mock.calls.find((c) => c[0] === START_CHAT_MUTATION);
    expect(startCall![1]).toMatchObject({ conversationName: null, isTestRun: true });
  });

  it('refuses an unauthenticated request before starting any chat', async () => {
    const POST = await importPOST();
    const res = await POST(ev({ body, token: null }));
    expect(res.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockRunChatTurn).not.toHaveBeenCalled();
  });
});
