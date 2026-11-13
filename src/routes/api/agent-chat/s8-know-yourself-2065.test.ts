/**
 * portal#2065 (S8 of the Know Yourself engine, hadron-server#3850): the portal side of the goal_reached
 * contract, bound at the gate in the issue's "Contract bound at the gate" B1-B9.
 *
 *  4a  goal_reached reaches processChatResponse (REGRESSION pin: the respond input is forwarded whole, B9);
 *  4b  the turn selects and returns the four new result fields;
 *  4d  the chat list selects completedConversations;
 *  4e  EDGE_CONDITION_FAILED on the partial-turn report keeps the saved bubble (B3), pinned both directions;
 *  B4  ENTRY_CONDITION_FAILED at start has its own fixed message per messageId, generic for an unknown id.
 *
 * Real runChatTurn and the real routes; only the GraphQL transport and the provider call are replaced.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROCESS_CHAT_RESPONSE_MUTATION, MY_CHATS_QUERY, SEND_CHAT_MESSAGE_MUTATION, START_CHAT_MUTATION, RESOLVE_AI_CONFIG_QUERY } from '$lib/server/queries';
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

const PROCESSED = {
  displayMessage: 'done',
  stageTransitioned: false,
  newStageName: null,
  conversationHandoff: null,
  chatEnded: false,
  onTrack: true,
  offTrackReason: null,
  conversationCompleted: null,
  detourReturned: false,
  rejectedNextStage: null,
  routingSkipped: false,
};
let PROCESSED_NOW: Record<string, unknown>;

function setup() {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === RESOLVE_AI_CONFIG_QUERY) return { resolveAIConfig: { provider: 'anthropic', apiKey: 'sk-synthetic-2065', model: 'm', params: null, effectiveEndpoint: 'https://api.anthropic.com/v1' } };
    if (doc === SEND_CHAT_MESSAGE_MUTATION) return { sendChatMessage: { systemMessage: 'sys', tools: null, messageHistory: [{ role: 'user', content: 'hi' }], summarizationNeeded: null } };
    if (doc === PROCESS_CHAT_RESPONSE_MUTATION) return { processChatResponse: PROCESSED_NOW };
    throw new Error(`unexpected operation: ${String(doc).slice(0, 50)}`);
  });
}
const post = (body: unknown) =>
  new Request('http://localhost/api/agent-chat/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ev = (body: unknown) => ({ request: post(body), locals: { token: 't', user: { id: 'u1' } } }) as never;
const turn = async () => (await import('./turn/+server')).POST(ev({ agentId: 'a', appId: 'app-1', chatId: 'c', userMessage: 'hi' }));

beforeEach(() => {
  mockRequest.mockReset();
  mockLlm.mockReset();
  __resetRateLimit();
  PROCESSED_NOW = { ...PROCESSED };
  setup();
});
afterEach(() => vi.restoreAllMocks());

describe('portal#2065 4a: goal_reached reaches processChatResponse (regression pin, B9)', () => {
  it('the flag the model set is forwarded untouched, and an absent flag stays absent', async () => {
    mockLlm.mockResolvedValue({ respond: { message: 'done', data: {}, next_stage: null, goal_reached: true }, rawText: '', usage: {} });
    await turn();
    expect(callsOf(PROCESS_CHAT_RESPONSE_MUTATION)[0].toolResponse).toMatchObject({ goal_reached: true });
    mockLlm.mockResolvedValue({ respond: { message: 'again' }, rawText: '', usage: {} });
    await turn();
    expect(callsOf(PROCESS_CHAT_RESPONSE_MUTATION)[1].toolResponse).not.toHaveProperty('goal_reached');
  });
});

describe('portal#2065 4b: the turn selects and returns the new result fields', () => {
  it('PROCESS_CHAT_RESPONSE_MUTATION selects conversationCompleted, detourReturned, rejectedNextStage and routingSkipped', () => {
    for (const field of ['conversationCompleted', 'detourReturned', 'rejectedNextStage', 'routingSkipped']) {
      expect(PROCESS_CHAT_RESPONSE_MUTATION).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('runChatTurn returns them to the page', async () => {
    PROCESSED_NOW = { ...PROCESSED, conversationCompleted: 'intro', detourReturned: true, rejectedNextStage: 'nope', routingSkipped: false, stageTransitioned: true, newStageName: 'back', conversationHandoff: 'main' };
    mockLlm.mockResolvedValue({ respond: { message: 'x' }, rawText: '', usage: {} });
    const body = await (await turn()).json();
    expect(body).toMatchObject({ conversationCompleted: 'intro', detourReturned: true, rejectedNextStage: 'nope', routingSkipped: false, stageTransitioned: true, newStageName: 'back', conversationHandoff: 'main' });
  });

  it('routingSkipped is logged once with the chat id and the flag only, and shows nothing to the reader (B5)', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    PROCESSED_NOW = { ...PROCESSED, routingSkipped: true, displayMessage: 'secret reply text' };
    mockLlm.mockResolvedValue({ respond: { message: 'x' }, rawText: '', usage: {} });
    await turn();
    const logged = JSON.stringify(info.mock.calls);
    expect(info).toHaveBeenCalledTimes(1);
    expect(logged).toContain('routingSkipped');
    expect(info.mock.calls[0][1]).toBe(JSON.stringify({ chatId: 'c', routingSkipped: true }));
    expect(logged).not.toContain('secret reply text');
    info.mockClear();
    PROCESSED_NOW = { ...PROCESSED };
    await turn();
    expect(info).not.toHaveBeenCalled();
  });
});

describe('portal#2065 4d: resume carries the done list', () => {
  it('MY_CHATS_QUERY selects completedConversations', () => {
    expect(MY_CHATS_QUERY).toMatch(/\bcompletedConversations\b/);
  });
});

describe('portal#2065 4e / B3: EDGE_CONDITION_FAILED partial turn keeps the saved bubble', () => {
  const SENTINEL = 'sentinel-condition-text';
  const edgeMarker = (persisted: string[]) => ({
    persisted,
    refused: [{ component: 'STAGE_PROGRESSION', code: 'EDGE_CONDITION_FAILED' }],
    notRun: [],
  });
  const refusal = (partialTurn?: unknown, code = 'EDGE_CONDITION_FAILED') => ({
    response: { errors: [{ message: `edge ${SENTINEL}`, extensions: { code, reason: SENTINEL, messageId: 'chat.edge', detail: SENTINEL, ...(partialTurn === undefined ? {} : { partialTurn }) } }] },
  });
  const run = async (err: unknown) => {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === RESOLVE_AI_CONFIG_QUERY) return { resolveAIConfig: { provider: 'anthropic', apiKey: 'k', model: 'm', params: null, effectiveEndpoint: 'https://api.anthropic.com/v1' } };
      if (doc === SEND_CHAT_MESSAGE_MUTATION) return { sendChatMessage: { systemMessage: 's', tools: null, messageHistory: [], summarizationNeeded: null } };
      throw err;
    });
    mockLlm.mockResolvedValue({ respond: { message: 'x' }, rawText: '', usage: {} });
    const res = await turn();
    return { res, text: await res.text() };
  };

  it('recognised: 409, partialTurn flag, fixed copy, nothing from the server leaks', async () => {
    const { res, text } = await run(refusal(edgeMarker(['ASSISTANT_MESSAGE', 'MESSAGE_COUNTER', 'EXTRACTION'])));
    expect(res.status).toBe(409);
    const body = JSON.parse(text);
    expect(body).toMatchObject({ code: 'partialTurnEdgeConditionFailed', partialTurn: true });
    expect(body.error).toMatch(/reply was saved/i);
    expect(text).not.toContain(SENTINEL);
  });

  it('a marker WITHOUT EXTRACTION in persisted is still recognised (EXTRACTION is conditional)', async () => {
    const { res, text } = await run(refusal(edgeMarker(['ASSISTANT_MESSAGE', 'MESSAGE_COUNTER'])));
    expect(res.status).toBe(409);
    expect(JSON.parse(text).partialTurn).toBe(true);
  });

  it.each([
    ['no marker', undefined],
    ['refused names another component', { persisted: ['ASSISTANT_MESSAGE'], refused: [{ component: 'EXTRACTION', code: 'EDGE_CONDITION_FAILED' }], notRun: [] }],
    ['refused names another code', { persisted: ['ASSISTANT_MESSAGE'], refused: [{ component: 'STAGE_PROGRESSION', code: 'SOMETHING_ELSE' }], notRun: [] }],
    ['assistant message not persisted', { persisted: ['MESSAGE_COUNTER'], refused: [{ component: 'STAGE_PROGRESSION', code: 'EDGE_CONDITION_FAILED' }], notRun: [] }],
    ['wrong types', { persisted: 'ASSISTANT_MESSAGE', refused: 'x', notRun: 5 }],
  ])('%s is today\'s generic failure: 500, no flag, never says the reply was saved', async (_n, marker) => {
    const { res, text } = await run(refusal(marker));
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: 'Chat request failed. Please try again.', code: 'failed' });
  });

  it('the extraction-refused shape is unchanged', async () => {
    const { res, text } = await run(refusal({ persisted: ['ASSISTANT_MESSAGE', 'MESSAGE_COUNTER'], refused: [{ component: 'EXTRACTION', code: 'AUTHORING_ATTESTATION_MISSING' }], notRun: ['STAGE_PROGRESSION'] }, 'AUTHORING_ATTESTATION_MISSING'));
    expect(res.status).toBe(409);
    expect(JSON.parse(text).code).toBe('partialTurnAttestationMissing');
  });
});

describe('portal#2065 B4: ENTRY_CONDITION_FAILED at start', () => {
  const SENTINEL = 'sentinel-fact-value';
  const failure = (messageId?: string) => ({
    response: { errors: [{ message: `cannot evaluate ${SENTINEL}`, extensions: { code: 'ENTRY_CONDITION_FAILED', reason: SENTINEL, detail: SENTINEL, ...(messageId ? { messageId } : {}) } }] },
  });
  async function start(err: unknown) {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === RESOLVE_AI_CONFIG_QUERY) return { resolveAIConfig: { provider: 'anthropic', apiKey: 'k', model: 'm', params: null, effectiveEndpoint: 'https://api.anthropic.com/v1' } };
      if (doc === START_CHAT_MUTATION) throw err;
      throw new Error('unexpected');
    });
    const res = await (await import('./start/+server')).POST(ev({ agentId: 'agent-1', appId: 'app-1', configName: 'default' }));
    return { res, text: await res.text() };
  }

  it.each([
    ['chat-start.error.memory_encrypted_no_key', 'startMemoryEncryptedNoKey'],
    ['chat-start.error.memory_unreadable', 'startMemoryUnreadable'],
    ['chat-start.error.invalid_condition', 'startInvalidCondition'],
    ['chat-start.error.type_mismatch', 'startTypeMismatch'],
  ])('%s gets its own fixed message in the 409 class, never the generic failure', async (messageId, code) => {
    const { res, text } = await start(failure(messageId));
    expect(res.status).toBe(409);
    const body = JSON.parse(text);
    expect(body.code).toBe(code);
    expect(body.error).not.toBe('Chat request failed. Please try again.');
    expect(text).not.toContain(SENTINEL);
  });

  it('an unknown messageId, or none, gets the generic "can\'t start right now" copy, still 409', async () => {
    for (const id of ['chat-start.error.brand_new', undefined]) {
      const { res, text } = await start(failure(id));
      expect(res.status).toBe(409);
      const body = JSON.parse(text);
      expect(body.code).toBe('startUnavailable');
      expect(body.error).toMatch(/can.t start right now/i);
      expect(text).not.toContain(SENTINEL);
    }
  });

  it('another code carrying one of these messageIds stays the generic failure', async () => {
    const err = { response: { errors: [{ message: 'x', extensions: { code: 'SOMETHING_ELSE', messageId: 'chat-start.error.memory_unreadable' } }] } };
    const { res, text } = await start(err);
    expect(res.status).toBe(500);
    expect(JSON.parse(text).code ?? 'failed').not.toBe('startMemoryUnreadable');
  });
});
