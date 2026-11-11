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
 *  - with no choice made, the key is OMITTED: the chat behaves as today;
 *  - the config that RUNS is resolved by the portal server from the choice (its name as the server lists it
 *    now) or from the chat, never from a client-sent configName (Juliet's BLIND F1 on #1978).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_AI_CONFIG_CHOICES_QUERY,
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

const MODELS: Record<string, string> = { default: 'model-default', fast: 'model-fast', smart: 'model-smart', quick: 'model-quick' };

/** The server's chatAiConfigChoices for app-1, as it stands NOW (a test may rename an entry). */
let CHOICES: Array<{ value: string; name: string; provider: string; model: string | null; isDefault: boolean; isAppChatbotConfig: boolean }>;
/** What resolveAIConfig(chatId:) answers with: the model of the chat's stored choice, per the server. */
let STORED_MODEL: string;

const notOwned = () => Object.assign(new Error('AI service config "cfg-x" not found'), {
  response: { errors: [{ message: 'AI service config "cfg-x" not found', extensions: { code: 'AiServiceConfigNotFoundError' } }] },
});

function setup(o: { refuseChoice?: boolean } = {}) {
  mockRequest.mockImplementation(async (doc: string, vars: Vars) => {
    if (o.refuseChoice && (doc === START_CHAT_MUTATION || doc === SEND_CHAT_MESSAGE_MUTATION) && vars.aiConfigChoice) throw notOwned();
    if (doc === CHAT_AI_CONFIG_CHOICES_QUERY) return { chatAiConfigChoices: CHOICES };
    if (doc === RESOLVE_AI_CONFIG_QUERY) {
      if (vars.chatId !== undefined && vars.name !== undefined) throw new Error('resolve by chatId OR name, not both');
      const model = vars.chatId !== undefined ? STORED_MODEL : MODELS[String(vars.name)];
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
  CHOICES = [
    { value: 'default', name: 'default', provider: 'anthropic', model: null, isDefault: true, isAppChatbotConfig: false },
    { value: 'cfg-fast', name: 'fast', provider: 'anthropic', model: 'model-fast', isDefault: false, isAppChatbotConfig: false },
    { value: 'cfg-smart', name: 'smart', provider: 'anthropic', model: 'model-smart', isDefault: false, isAppChatbotConfig: false },
  ];
  STORED_MODEL = 'model-smart';
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
    CHOICES.push({ value: 'cfg-x', name: 'fast', provider: 'anthropic', model: 'model-fast', isDefault: false, isAppChatbotConfig: false });
    const res = await start({ agentId: 'agent-1', appId: 'app-1', configName: 'fast', aiConfigChoice: 'cfg-x' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('configChoiceUnavailable');
    expect(JSON.stringify(body)).not.toContain('cfg-x');
  });

  it('runs the config the server lists for the id NOW, whatever name the client sends (BLIND F1)', async () => {
    CHOICES[1] = { ...CHOICES[1], name: 'quick' }; // renamed after the page loaded
    await start({ agentId: 'agent-1', appId: 'app-1', configName: 'fast', aiConfigChoice: 'cfg-fast' });
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toEqual([{ name: 'quick', appRef: 'app-1', agentRef: 'agent-1' }]);
    expect(mockLlm.mock.calls[0][0].model).toBe('model-quick');
  });

  it('ignores a configName that disagrees with the choice', async () => {
    await start({ agentId: 'agent-1', appId: 'app-1', configName: 'smart', aiConfigChoice: 'cfg-fast' });
    expect(mockLlm.mock.calls[0][0].model).toBe('model-fast');
  });

  it('with no choice, a new chat runs the App chatbot config the server lists, not a client name', async () => {
    CHOICES[2] = { ...CHOICES[2], isAppChatbotConfig: true };
    await start({ agentId: 'agent-1', appId: 'app-1', configName: 'fast' });
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toEqual([{ name: 'smart', appRef: 'app-1', agentRef: 'agent-1' }]);
    expect('aiConfigChoice' in callsOf(START_CHAT_MUTATION)[0]).toBe(false);
  });

  it('the default marker and an App config NAMED default resolve the same walk (BLIND F2)', async () => {
    // By the server's contract the `default` walk starts at the App, and the App's own config is the innermost
    // owner for its name, so the marker and that config's id both land on that config.
    CHOICES.push({ value: 'cfg-own-default', name: 'default', provider: 'anthropic', model: 'model-default', isDefault: false, isAppChatbotConfig: false });
    await start({ agentId: 'agent-1', appId: 'app-1', aiConfigChoice: 'cfg-own-default' });
    await start({ agentId: 'agent-1', appId: 'app-1', aiConfigChoice: 'default' });
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toEqual([
      { name: 'default', appRef: 'app-1', agentRef: 'agent-1' },
      { name: 'default', appRef: 'app-1', agentRef: 'agent-1' },
    ]);
    // What is STORED differs, and that is what the server keys later turns on.
    expect(callsOf(START_CHAT_MUTATION).map((v) => v.aiConfigChoice)).toEqual(['cfg-own-default', 'default']);
  });

  it('a choice the server no longer lists is refused before startChat runs a model', async () => {
    const res = await start({ agentId: 'agent-1', appId: 'app-1', aiConfigChoice: 'cfg-gone' });
    // startChat still judges the id itself (the mock accepts it here), so the chat starts with no model
    // reported and no welcome turn run against a config.
    expect(res.status).toBe(200);
    expect('llmModel' in callsOf(START_CHAT_MUTATION)[0]).toBe(false);
    expect(mockLlm).not.toHaveBeenCalled();
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

  it('with no choice made, aiConfigChoice is OMITTED and the chat resolves by its id (stored choice)', async () => {
    await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi', appId: 'app-1', configName: 'default' });
    const [vars] = callsOf(SEND_CHAT_MESSAGE_MUTATION);
    expect('aiConfigChoice' in vars).toBe(false);
    expect(callsOf(RESOLVE_AI_CONFIG_QUERY)).toEqual([{ chatId: 'chat-1', appRef: 'app-1', agentRef: 'agent-1' }]);
    expect(vars.llmModel).toBe('model-smart');
    expect(mockLlm.mock.calls[0][0].model).toBe('model-smart');
  });

  it('a renamed config runs by its current name; a stale client name is ignored (BLIND F1)', async () => {
    CHOICES[1] = { ...CHOICES[1], name: 'quick' };
    await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi', appId: 'app-1', configName: 'fast', aiConfigChoice: 'cfg-fast' });
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION)[0]).toMatchObject({ llmModel: 'model-quick', aiConfigChoice: 'cfg-fast' });
  });

  it('a choice the server no longer lists is refused before sendChatMessage or a model call', async () => {
    const res = await turn({ agentId: 'agent-1', chatId: 'chat-1', userMessage: 'hi', appId: 'app-1', aiConfigChoice: 'cfg-gone' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('configChoiceUnavailable');
    expect(callsOf(SEND_CHAT_MESSAGE_MUTATION)).toHaveLength(0);
    expect(mockLlm).not.toHaveBeenCalled();
  });

  it('a choice the server refuses shows one fixed message, never the server text', async () => {
    setup({ refuseChoice: true });
    CHOICES.push({ value: 'cfg-x', name: 'fast', provider: 'anthropic', model: 'model-fast', isDefault: false, isAppChatbotConfig: false });
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
