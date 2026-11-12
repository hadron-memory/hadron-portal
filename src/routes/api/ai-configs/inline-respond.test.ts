/** #2032: actual POST + locked SDK, intercepted fetch, no provider/key/GraphQL writes. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetRateLimit } from '$lib/server/rate-limit';
import { CHAT_ERROR } from '$lib/server/llm/chatError';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { POST } from './+server';
// Fixture copied from buildRespondToolSchema with resolveExtractionSpec -> [],
// hadron-server 6c4adcc4e24e2bdffb8c87b69f60d2d84bd3dff6,
// src/api/graphql/schema/resolvers.helpers.ts:3817-3855. Open objects intentional.
const SERVER_EMPTY_EXTRACTION_SCHEMA = {
  type: 'object', properties: {
    message: { type: 'string', description: 'Your response to the user' },
    data: { type: 'object', properties: {} },
    next_stage: { type: ['string', 'null'], description: 'Stage to transition to (null to stay in current stage)' },
    onTrack: { type: 'boolean', description: 'Is the current conversation/stage still the right fit for what the user is asking?' },
    offTrackReason: { type: 'string', description: 'If onTrack is false, explain why the conversation seems off-track' },
  }, required: ['message', 'onTrack'],
};
const KEY = 'sk-ant-SYNTHETIC2032';
const use = (input: unknown = { message: 'Reachable.', onTrack: true, data: {}, next_stage: null }, name = 'respond', id = 'tool1') => ({ type: 'tool_use', id, name, input });
const reply = (content: unknown[]) => Response.json({ id: 'fixture', type: 'message', role: 'assistant', model: 'fixture', stop_reason: 'tool_use', content, usage: { input_tokens: 1, output_tokens: 1 } });
let response: () => Response, bodies: any[], logs: unknown[][];
let fetcher: ReturnType<typeof vi.fn>;
beforeEach(() => {
  request.mockReset(); __resetRateLimit(); bodies = []; logs = [];
  response = () => reply([use()]);
  fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    expect(new Headers(init?.headers).get('x-api-key')).toBe(KEY);
    bodies.push(JSON.parse(String(init?.body))); return response();
  });
  vi.stubGlobal('fetch', fetcher);
  vi.spyOn(console, 'warn').mockImplementation((...args) => { logs.push(args); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const event = (body: Record<string, unknown>, token: string | null = 'synthetic-session') => ({
  locals: { token, user: { id: 'synthetic-user' } },
  request: { json: async () => body }, url: new URL('http://localhost/api/ai-configs'),
}) as any;
const postTest = (extra: Record<string, unknown> = {}) => POST(event({ action: 'test', provider: 'anthropic', model: 'claude-sonnet-5-5', apiKey: KEY, ...extra }));

it.each(['claude-sonnet-5-5', 'claude-haiku-5-5'])('%s uses the chat request builder and real respond schema', async model => {
  const result = await postTest({ model });
  expect(await result.json()).toMatchObject({ ok: true, reply: 'Reachable.', model, provider: 'anthropic' });
  expect(bodies).toHaveLength(1);
  expect(bodies[0].model).toBe(model);
  expect(bodies[0].tool_choice).toEqual(model === 'claude-sonnet-5-5' ? { type: 'auto' } : { type: 'tool', name: 'respond' });
  expect(bodies[0].tools).toEqual([{ name: 'respond', description: 'Respond to the user and extract data', input_schema: SERVER_EMPTY_EXTRACTION_SCHEMA }]);
  expect(request).not.toHaveBeenCalled();
});
it.each(['text', 'two', 'other', 'missing-message', 'number-message', '400'])('%s fails closed without writes or model/provider text', async kind => {
  const secretText = `RAW_MODEL_TEXT ${KEY}`;
  response = () => kind === '400' ? Response.json({ error: { type: 'invalid_request_error', message: secretText } }, { status: 400 }) : reply(
    kind === 'text' ? [{ type: 'text', text: secretText }] : kind === 'two' ? [use(), use(undefined, 'respond', 'tool2')]
    : kind === 'other' ? [use({}, 'other')] : kind === 'missing-message' ? [use({ onTrack: true })] : [use({ message: 42, onTrack: true })]);
  const result = await postTest();
  expect(await result.json()).toEqual({ ok: false, error: CHAT_ERROR.llmFailed, code: 'llmFailed' });
  expect(fetcher).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled();
  expect(logs).toHaveLength(1); expect(JSON.stringify(logs)).not.toMatch(/RAW_MODEL_TEXT|SYNTHETIC2032/);
});
it('no raw-text fallback even if the provider includes text beside a valid call', async () => {
  response = () => reply([{ type: 'text', text: 'RAW_MODEL_TEXT' }, use()]);
  expect(await (await postTest()).json()).toMatchObject({ ok: true, reply: 'Reachable.' });
  expect(request).not.toHaveBeenCalled();
});
it('no SDK retry on a transient provider rejection', async () => {
  response = () => Response.json({ error: { type: 'overloaded_error', message: KEY } }, { status: 503 });
  expect(await (await postTest()).json()).toMatchObject({ ok: false, code: 'llmFailed' });
  expect(fetcher).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled();
});
it('the 20s deadline aborts a hung provider with a closed result', async () => {
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(ms => {
    expect(ms).toBe(20_000); return timeout(1); // shorten wall time, preserve real abort behavior
  });
  fetcher.mockImplementation(async (_url: unknown, init?: RequestInit) => new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) reject(signal.reason);
    else signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  expect(await (await postTest()).json()).toEqual({ ok: false, error: CHAT_ERROR.llmFailed, code: 'llmFailed' });
  expect(fetcher).toHaveBeenCalledOnce(); expect(request).not.toHaveBeenCalled();
});
it('existing per-user 20/min limit prevents request 21', async () => {
  for (let i = 0; i < 20; i++) expect((await postTest()).status).toBe(200);
  expect((await postTest()).status).toBe(429); expect(fetcher).toHaveBeenCalledTimes(20);
  expect(request).not.toHaveBeenCalled();
});
it('authentication and inlineTestable refusal make no provider call', async () => {
  expect((await POST(event({ action: 'test' }, null))).status).toBe(401);
  expect((await postTest({ provider: 'glm' })).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled(); expect(request).not.toHaveBeenCalled();
});
