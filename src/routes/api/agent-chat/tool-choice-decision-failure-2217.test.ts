/**
 * portal#2217 item 3 (BLIND F6): a failing tool-choice decision query ends the turn closed, before any provider
 * call and without surfacing server text. Real runChatTurn and routes; only the GraphQL transport and the
 * provider call are replaced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROCESS_CHAT_RESPONSE_MUTATION, RESOLVE_AI_CONFIG_QUERY, SEND_CHAT_MESSAGE_MUTATION } from '$lib/server/queries';
import { __resetRateLimit } from '$lib/server/rate-limit';

const mockRequest = vi.fn();
const mockLlm = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/llm/agentChatLlm.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/llm/agentChatLlm.js')>('$lib/server/llm/agentChatLlm.js');
  return { ...actual, callAgentChatLlm: (...a: unknown[]) => mockLlm(...a) };
});

const SENTINEL = 'sk-synthetic-2217-decision';
const post = (body: unknown) =>
  new Request('http://localhost/api/agent-chat/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ev = (body: unknown) => ({ request: post(body), locals: { token: 't', user: { id: 'u1' } } }) as never;
const turn = async () => (await import('./turn/+server')).POST(ev({ agentId: 'a', appId: 'app-1', chatId: 'c', userMessage: 'hi' }));

/** A read refusal, not the old server's unknown root field: it must not read as "forced". */
const refusal = () => Object.assign(new Error(`denied ${SENTINEL}`), {
  response: { errors: [{ message: `denied ${SENTINEL}`, path: ['chatEffectiveToolChoice'], extensions: { code: 'FORBIDDEN' } }] },
});

function setup(decision: () => unknown) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc.includes('chatEffectiveToolChoice(')) return decision();
    if (doc === RESOLVE_AI_CONFIG_QUERY) return { resolveAIConfig: { provider: 'anthropic', apiKey: 'k', model: 'm', params: null, effectiveEndpoint: 'https://api.anthropic.com/v1' } };
    if (doc === SEND_CHAT_MESSAGE_MUTATION) return { sendChatMessage: { systemMessage: 's', tools: null, messageHistory: [], summarizationNeeded: null } };
    throw new Error(`unexpected operation: ${String(doc).slice(0, 50)}`);
  });
  mockLlm.mockResolvedValue({ respond: { message: 'x' }, rawText: '', usage: {} });
}

beforeEach(() => {
  mockRequest.mockReset();
  mockLlm.mockReset();
  __resetRateLimit();
});

describe('portal#2217: a failed decision query is a closed public error', () => {
  it('a refusal fails the turn: no provider call, no processChatResponse, nothing from the server leaks', async () => {
    setup(() => { throw refusal(); });
    const res = await turn();
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toContain(SENTINEL);
    expect(mockLlm).not.toHaveBeenCalled();
    expect(mockRequest.mock.calls.some((c) => c[0] === PROCESS_CHAT_RESPONSE_MUTATION)).toBe(false);
  });

  it('control: the old server\'s unknown root field is the one failure that degrades to a forced turn', async () => {
    setup(() => { throw Object.assign(new Error('x'), { response: { errors: [{ message: 'Cannot query field "chatEffectiveToolChoice" on type "Query".', extensions: { code: 'GRAPHQL_VALIDATION_FAILED' } }] } }); });
    await turn();
    expect(mockLlm).toHaveBeenCalledTimes(1);
    expect(mockLlm.mock.calls[0][0]).toMatchObject({ toolChoice: 'FORCED' });
  });
});
