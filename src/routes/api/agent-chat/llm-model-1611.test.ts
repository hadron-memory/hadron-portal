/**
 * portal#1611 — the chat model the portal actually calls is reported to the
 * server (hadron-server#3096, hrn:node:hadronmemory.com:specs:cor:dmo:150:08) on every startChat and
 * sendChatMessage, as an optional `llmModel` GraphQL variable.
 *
 * These run the REAL runChatTurn / config resolution; only the GraphQL
 * transport and the provider call are replaced, so a pin fails when the wire
 * is wrong, not when a mock is. The provider is synthetic: nothing here proves
 * a real LLM was called.
 *
 * Contract (gate comment, Petra AT0.4476.3, A1–A8):
 *  - the config is resolved ONCE before startChat and reused for the welcome
 *    turn and the later turns of the same request;
 *  - the resolved `model` is sent RAW (no trim, no local validation, no cap);
 *  - when no config resolves, or one is refused, the key is OMITTED — never
 *    null, never "", never a guess;
 *  - a refused start/send shows one fixed message and is never replayed, in
 *    particular never without `llmModel`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROCESS_CHAT_RESPONSE_MUTATION,
  RESOLVE_AI_CONFIG_QUERY,
  SEND_CHAT_MESSAGE_MUTATION,
  START_CHAT_MUTATION,
} from '$lib/server/queries';
import { __resetRateLimit } from '$lib/server/rate-limit';
import { asTesterManager } from '$lib/test/tester-manage';

const mockRequest = vi.fn();
const mockLlm = vi.fn();

vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: (q: string, v?: unknown) => asTesterManager(mockRequest, { visibleAgentIds: ['agent-1'] })(q, v) }) }));
vi.mock('$lib/server/llm/agentChatLlm.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/llm/agentChatLlm.js')>('$lib/server/llm/agentChatLlm.js');
  return { ...actual, callAgentChatLlm: (...a: unknown[]) => mockLlm(...a) };
});

const KEY = 'sk-synthetic-1611-never-on-the-wire';

type Vars = Record<string, unknown>;
const callsOf = (doc: string) => mockRequest.mock.calls.filter((c) => c[0] === doc).map((c) => (c[1] ?? {}) as Vars);

const config = (model: unknown, extra: Record<string, unknown> = {}) => ({
  resolveAIConfig: { provider: 'anthropic', apiKey: KEY, model, params: null, effectiveEndpoint: 'https://api.anthropic.com/v1', ...extra },
});
const gqlError = (code: string, message = 'server prose that must not reach the user') =>
  Object.assign(new Error(message), { response: { errors: [{ message, extensions: { code } }] } });

/** `resolve` answers each ResolveAIConfig in order; the last one repeats. */
function setup(o: { resolve?: Array<unknown | Error>; start?: Error; send?: Error } = {}) {
  const resolve = o.resolve ?? [config('model-X')];
  let n = 0;
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc.includes('chatEffectiveToolChoice(')) return { chatEffectiveToolChoice: 'FORCED' };
    if (doc === RESOLVE_AI_CONFIG_QUERY) {
      const r = resolve[Math.min(n++, resolve.length - 1)];
      if (r instanceof Error) throw r;
      return r;
    }
    if (doc === START_CHAT_MUTATION) {
      if (o.start) throw o.start;
      return { startChat: { chatId: 'chat-1', systemMessage: 'sys', tools: null, conversationName: 'c', stageName: 's' } };
    }
    if (doc === SEND_CHAT_MESSAGE_MUTATION) {
      if (o.send) throw o.send;
      return { sendChatMessage: { systemMessage: 'sys', tools: null, messageHistory: [{ role: 'user', content: 'hi' }], summarizationNeeded: null } };
    }
    if (doc === PROCESS_CHAT_RESPONSE_MUTATION) {
      return { processChatResponse: { displayMessage: 'hello', stageTransitioned: false, newStageName: null, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null, conversationCompleted: null, detourReturned: false, rejectedNextStage: null, routingSkipped: false } };
    }
    throw new Error(`unexpected operation: ${String(doc).slice(0, 50)}`);
  });
  mockLlm.mockResolvedValue({ respond: { message: 'hello' }, rawText: 'hello', usage: {} });
}

function ev(body: unknown) {
  return {
    request: new Request('http://test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    locals: { token: 'test-token', user: { id: 'u1' } },
  } as never;
}
const start = async (body: Vars = { agentId: 'agent-1' }) => (await import('./start/+server')).POST(ev(body));
const turn = async (body: Vars = { agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi' }) => (await import('./turn/+server')).POST(ev(body));
const testRun = async () => (await import('./test-run/+server')).POST(ev({ agentId: 'agent-1', message: 'hi' }));
const persona = async () => (await import('./test-persona/+server')).POST(ev({
  agentId: 'agent-1', personaName: 'P', openingMessage: 'hello', followUpMessages: ['next'], conversationName: 'setup',
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockLlm.mockReset();
  __resetRateLimit();
});

describe('portal#1611 /start reports the model it will call', () => {
  it('A1: startChat carries the resolved model', async () => {
    setup({ resolve: [config('model-X')] });
    const res = await start();
    expect(res.status).toBe(200);
    expect(callsOf(START_CHAT_MUTATION)).toEqual([{ agentRef: 'agent-1', conversationName: null, scope: 'private', llmModel: 'model-X' }]);
  });

  it('A2: the welcome turn runs the SAME model, and the config is resolved once per /start', async () => {
    setup({ resolve: [config('model-X'), config('model-DRIFT')] });
    await start();
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toHaveLength(1);
    expect(mockLlm).toHaveBeenCalledTimes(1);
    expect(mockLlm.mock.calls[0][0].model).toBe('model-X');
  });

  it('A4: with no config the chat still starts and the key is OMITTED (not null, not empty)', async () => {
    setup({ resolve: [new Error('NoAiConfigAvailableError: nothing')] });
    const res = await start();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.chatId).toBe('chat-1');
    expect(body.welcomeError).toBeTruthy();
    const [vars] = callsOf(START_CHAT_MUTATION);
    expect('llmModel' in vars).toBe(false);
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toHaveLength(1);
  });

  it('A4: a config the portal runtime refuses (custom endpoint) also omits the key and never sends its model', async () => {
    setup({ resolve: [config('custom-model', { effectiveEndpoint: 'https://llm.internal.example/v1' })] });
    const res = await start();
    expect(res.status).toBe(200);
    expect('llmModel' in callsOf(START_CHAT_MUTATION)[0]).toBe(false);
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('A4: an empty resolved model is not a model: omitted, never ""', async () => {
    setup({ resolve: [config('')] });
    await start();
    expect('llmModel' in callsOf(START_CHAT_MUTATION)[0]).toBe(false);
  });

  it('A6b: a refused start is shown as one fixed message and is never replayed, with or without llmModel', async () => {
    setup({ start: gqlError('BAD_USER_INPUT', 'llmModel "model-X" is invalid') });
    const res = await start();
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain('model-X');
    expect(text).not.toContain('server prose');
    expect(callsOf(START_CHAT_MUTATION)).toHaveLength(1);
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION)).toHaveLength(0);
    expect(mockLlm).not.toHaveBeenCalled();
  });
});

describe('portal#1611 /turn reports the model it will call, every turn', () => {
  it('A3: each send carries the model resolved for THAT turn (a switch is reported)', async () => {
    setup({ resolve: [config('model-Y')] });
    await turn();
    await turn();
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION).map((v) => v.llmModel)).toEqual(['model-Y', 'model-Y']);
    setup({ resolve: [config('model-Z')] });
    mockRequest.mockClear();
    await turn();
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION).map((v) => v.llmModel)).toEqual(['model-Z']);
    expect(mockLlm.mock.calls.at(-1)![0].model).toBe('model-Z');
  });

  it('A6/A6b: a refused send gives one fixed message; no second send, with or without llmModel', async () => {
    setup({ send: gqlError('BAD_USER_INPUT', 'llmModel too long: model-Y') });
    const res = await turn();
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body).toEqual({ error: 'Chat request failed. Please try again.', code: 'failed' });
    expect(JSON.stringify(body)).not.toContain('model-Y');
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION)).toHaveLength(1);
    expect(callsOf(START_CHAT_MUTATION)).toHaveLength(0);
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('A6c: the model is sent RAW — over 256 code units, a control character, surrounding spaces — never trimmed, never dropped', async () => {
    for (const raw of ['m'.repeat(300), 'bad\u0007model', '  spaced  ', 'line sep']) {
      setup({ resolve: [config(raw)] });
      mockRequest.mockClear();
      await turn();
      const [v] = callsOf(SEND_CHAT_MESSAGE_MUTATION);
      expect(v.llmModel).toBe(raw);
    }
  });

  it('A6c: the same raw value reaches startChat', async () => {
    const raw = ' ' + 'm'.repeat(300) + '\u0007';
    setup({ resolve: [config(raw)] });
    await start();
    expect(callsOf(START_CHAT_MUTATION)[0].llmModel).toBe(raw);
  });

  it('A7: the decrypted key is never in any start or send variables, and resolution keeps its arguments', async () => {
    // Without an App (the Tester's path) the named config is resolved as asked. In an App the portal resolves
    // from the choice or the chat instead (portal#1963; ai-config-choice-1963.test.ts).
    setup({ resolve: [config('model-X')] });
    await start({ agentId: 'agent-1', configName: 'fast' });
    await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi', configName: 'fast' });
    const wire = JSON.stringify([...callsOf(START_CHAT_MUTATION), ...callsOf(SEND_CHAT_MESSAGE_MUTATION)]);
    expect(wire).not.toContain(KEY);
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)[0]).toEqual({ name: 'fast', agentRef: 'agent-1' });
  });
});

describe('portal#1611 the tester endpoints are chats too (A5)', () => {
  it('test-run: start AND send carry the model; isTestRun is unchanged; one resolution', async () => {
    setup({ resolve: [config('model-X'), config('model-DRIFT')] });
    const res = await testRun();
    expect(res.status).toBe(200);
    expect(callsOf(START_CHAT_MUTATION)).toEqual([{ agentRef: 'agent-1', conversationName: null, scope: 'private', isTestRun: true, llmModel: 'model-X' }]);
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION).map((v) => v.llmModel)).toEqual(['model-X']);
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toHaveLength(1);
    expect(mockLlm.mock.calls.every((c) => c[0].model === 'model-X')).toBe(true);
  });

  it('test-persona: start AND every send carry the model; isTestRun is unchanged; one resolution', async () => {
    setup({ resolve: [config('model-X'), config('model-DRIFT')] });
    const res = await persona();
    expect(res.status).toBe(200);
    expect(callsOf(START_CHAT_MUTATION)).toEqual([{ agentRef: 'agent-1', conversationName: 'setup', scope: 'private', isTestRun: true, llmModel: 'model-X' }]);
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION).map((v) => v.llmModel)).toEqual(['model-X', 'model-X']);
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toHaveLength(1);
  });

  it('test-run: with no config the chat still starts without the key, and the caller gets the fixed no-config error', async () => {
    setup({ resolve: [new Error('NoAiConfigAvailableError: nothing')] });
    const res = await testRun();
    expect(res.status).toBe(409);
    expect('llmModel' in callsOf(START_CHAT_MUTATION)[0]).toBe(false);
    expect(callsOf(START_CHAT_MUTATION)).toHaveLength(1);
  });

  it('test-run: a refused send is not replayed', async () => {
    setup({ send: gqlError('BAD_USER_INPUT') });
    const res = await testRun();
    expect(res.status).toBe(500);
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION)).toHaveLength(1);
    expect(callsOf(START_CHAT_MUTATION)).toHaveLength(1);
  });
});

describe('runtime compatibility across shared request entrypoints', () => {
  for (const [provider, effectiveEndpoint] of [
    ['anthropic', 'https://api.anthropic.com/v1'],
    ['openai', 'https://api.openai.com/v1'],
    ['glm', 'https://api.z.ai/api/paas/v4'],
    ['bedrock', null],
  ] as const) {
    it.each([['start', start], ['continuation', turn], ['test-run', testRun], ['test-persona', persona]] as const)(
      `${provider} %s refuses identity-only resolution before provider use`, async (_name, request) => {
        setup({ resolve: [config('model-X', { provider, effectiveEndpoint, apiKey: null, params: { secret: KEY } })] });
        const response = await request();
        const body = await response.text();
        expect(body).not.toContain(KEY);
        if (_name === 'start') {
          expect(response.status).toBe(200); // Existing chat creation + soft welcome refusal.
          expect(JSON.parse(body).welcomeError).toMatch(/credential.*not available/i);
          expect(callsOf(START_CHAT_MUTATION)[0]).not.toHaveProperty('llmModel');
        } else {
          expect(response.status).toBeGreaterThanOrEqual(400);
          expect(body).toContain('credentialUnavailable');
        }
        expect(mockLlm).not.toHaveBeenCalled();
        expect(callsOf(PROCESS_CHAT_RESPONSE_MUTATION)).toEqual([]);
        expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toHaveLength(1);
      },
    );
  }
});
