/**
 * portal#1963: the chat's AI config choice goes with startChat / sendChatMessage
 * (hadron-server#3957, hrn:node:hadronmemory.com:specs:cor:dmo:050:10), and the
 * turn runs the config it names.
 *
 * Runs the REAL runChatTurn and config resolution; only the GraphQL transport
 * and the provider call are replaced (the same seam as llm-model-1611.test.ts).
 *
 *  - a choice the user made is sent as `aiConfigChoice` and stored by the server;
 *  - switching configs changes the model the next turn calls and reports;
 *  - with no choice made, the key is OMITTED: the chat behaves as today.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROCESS_CHAT_RESPONSE_MUTATION,
  RESOLVE_AI_CONFIG_QUERY,
  SEND_CHAT_MESSAGE_MUTATION,
  START_CHAT_MUTATION,
} from '$lib/server/queries';
import { __resetRateLimit } from '$lib/server/rate-limit';

const mockRequest = vi.fn();
const mockLlm = vi.fn();

vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/llm/agentChatLlm.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/llm/agentChatLlm.js')>('$lib/server/llm/agentChatLlm.js');
  return { ...actual, callAgentChatLlm: (...a: unknown[]) => mockLlm(...a) };
});

type Vars = Record<string, unknown>;
const callsOf = (doc: string) => mockRequest.mock.calls.filter((c) => c[0] === doc).map((c) => (c[1] ?? {}) as Vars);

const MODELS: Record<string, string> = { default: 'model-default', fast: 'model-fast', smart: 'model-smart' };

const notOwned = () => Object.assign(new Error('AI service config "cfg-x" not found'), {
  response: { errors: [{ message: 'AI service config "cfg-x" not found', extensions: { code: 'AiServiceConfigNotFoundError' } }] },
});

function setup(o: { refuseChoice?: boolean } = {}) {
  mockRequest.mockImplementation(async (doc: string, vars: Vars) => {
    if (o.refuseChoice && (doc === START_CHAT_MUTATION || doc === SEND_CHAT_MESSAGE_MUTATION) && vars.aiConfigChoice) throw notOwned();
    if (doc === RESOLVE_AI_CONFIG_QUERY) {
      const model = MODELS[String(vars.name)];
      if (!model) throw new Error('NoAiConfigAvailableError: nothing');
      return { resolveAIConfig: { provider: 'anthropic', apiKey: 'sk-synthetic-1963', model, params: null, effectiveEndpoint: 'https://api.anthropic.com/v1' } };
    }
    if (doc === START_CHAT_MUTATION) {
      return { startChat: { chatId: 'chat-1', systemMessage: 'sys', tools: null, conversationName: 'c', stageName: 's' } };
    }
    if (doc === SEND_CHAT_MESSAGE_MUTATION) {
      return { sendChatMessage: { systemMessage: 'sys', tools: null, messageHistory: [{ role: 'user', content: 'hi' }], summarizationNeeded: null } };
    }
    if (doc === PROCESS_CHAT_RESPONSE_MUTATION) {
      return { processChatResponse: { displayMessage: 'hello', stageTransitioned: false, newStageName: null, conversationHandoff: null, chatEnded: false, onTrack: true, offTrackReason: null } };
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
const start = async (body: Vars) => (await import('./start/+server')).POST(ev(body));
const turn = async (body: Vars) => (await import('./turn/+server')).POST(ev(body));

beforeEach(() => {
  mockRequest.mockReset();
  mockLlm.mockReset();
  __resetRateLimit();
  setup();
});

describe('portal#1963 /start', () => {
  it('sends the chosen config id with startChat and runs that config', async () => {
    const res = await start({ agentId: 'agent-1', appId: 'app-1', configName: 'fast', aiConfigChoice: 'cfg-fast' });
    expect(res.status).toBe(200);
    expect(callsOf(START_CHAT_MUTATION)).toEqual([
      { agentId: 'agent-1', conversationName: null, scope: 'private', llmModel: 'model-fast', aiConfigChoice: 'cfg-fast' },
    ]);
    expect(mockLlm.mock.calls[0][0].model).toBe('model-fast');
  });

  it('sends default as a choice when default was chosen', async () => {
    await start({ agentId: 'agent-1', appId: 'app-1', configName: 'default', aiConfigChoice: 'default' });
    expect(callsOf(START_CHAT_MUTATION)[0].aiConfigChoice).toBe('default');
  });

  it('with no choice made, aiConfigChoice is OMITTED (as today)', async () => {
    await start({ agentId: 'agent-1', appId: 'app-1', configName: 'default' });
    const [vars] = callsOf(START_CHAT_MUTATION);
    expect('aiConfigChoice' in vars).toBe(false);
    expect(vars.llmModel).toBe('model-default');
  });

  it('a choice the server refuses at start shows one fixed message', async () => {
    setup({ refuseChoice: true });
    const res = await start({ agentId: 'agent-1', appId: 'app-1', configName: 'fast', aiConfigChoice: 'cfg-x' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('configChoiceUnavailable');
    expect(JSON.stringify(body)).not.toContain('cfg-x');
  });

  it('refuses a choice that is not a string, before anything is written', async () => {
    const res = await start({ agentId: 'agent-1', appId: 'app-1', aiConfigChoice: { id: 'x' } });
    expect(res.status).toBe(400);
    expect(callsOf(START_CHAT_MUTATION)).toHaveLength(0);
  });
});

describe('portal#1963 /turn', () => {
  it('sends the chosen config id with sendChatMessage', async () => {
    const res = await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi', appId: 'app-1', configName: 'smart', aiConfigChoice: 'cfg-smart' });
    expect(res.status).toBe(200);
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION)).toEqual([
      { chatId: 'chat-1', userMessage: 'hi', llmModel: 'model-smart', aiConfigChoice: 'cfg-smart' },
    ]);
  });

  it('switching configs changes the model the next turn calls and reports', async () => {
    await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'one', appId: 'app-1', configName: 'fast', aiConfigChoice: 'cfg-fast' });
    await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'two', appId: 'app-1', configName: 'smart', aiConfigChoice: 'cfg-smart' });
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION).map((v) => v.llmModel)).toEqual(['model-fast', 'model-smart']);
    expect(mockLlm.mock.calls.map((c) => c[0].model)).toEqual(['model-fast', 'model-smart']);
  });

  it('with no choice made, aiConfigChoice is OMITTED (as today)', async () => {
    await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi', appId: 'app-1', configName: 'default' });
    const [vars] = callsOf(SEND_CHAT_MESSAGE_MUTATION);
    expect('aiConfigChoice' in vars).toBe(false);
  });

  it('a choice the server refuses shows one fixed message, never the server text', async () => {
    setup({ refuseChoice: true });
    const res = await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi', appId: 'app-1', configName: 'fast', aiConfigChoice: 'cfg-x' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('configChoiceUnavailable');
    expect(body.error).not.toContain('cfg-x');
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('refuses a choice that is not a string, before anything is written', async () => {
    const res = await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi', aiConfigChoice: 7 });
    expect(res.status).toBe(400);
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION)).toHaveLength(0);
  });
});
