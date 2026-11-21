/**
 * #1979 (diagnostic slice): a failed AI turn leaves ONE closed, server-side log
 * line, and nothing the caller sees changes. Synthetic only: the real SDK over
 * an intercepted fake fetch, no network, no provider, no real key.
 *
 * The log line may carry only this module's own vocabulary and integers. Every
 * sentinel below stands for a secret, a prompt, customer data or a
 * user-controlled name and must never reach ANY logger argument.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APICallError } from 'ai';
import { callAgentChatLlm, describeLlmFailure, LOGGABLE_PROVIDERS } from './agentChatLlm.js';
import { CHAT_ERROR, ChatError, publicChatError } from './chatError.js';

const KEY = 'sk-ant-SENTINEL-KEY-1979';
const PROMPT = 'SENTINEL-PROMPT-1979 customer says hello';
const MODEL = 'SENTINEL-MODEL-1979';
const BODY = 'SENTINEL-BODY-1979';
const TYPE = 'SENTINEL-TYPE-1979';
const RID = 'SENTINEL-REQID-1979';
const ALL_SENTINELS = [KEY, PROMPT, MODEL, BODY, TYPE, RID, 'SENTINEL', 'customer says hello', 'customer', 'says', 'hello'];

const LINE = new RegExp(String.raw`^\[agent-chat\] llm turn failed class=(config|provider-status|request-failed|unexpected-tool-output|auto-no-respond) stage=(config|request|tool-output) branch=(plain|respond) choice=(auto|forced|none) turn=(welcome|turn) provider=(` + [...LOGGABLE_PROVIDERS, 'unknown'].join('|') + String.raw`) status=(\d{3}|none) type=(invalid_request_error|authentication_error|permission_error|not_found_error|rate_limit_error|api_error|overloaded_error|none) tools=(\d+)$`);

const RESPOND = { name: 'respond', description: PROMPT, parameters: { type: 'object', properties: { message: { type: 'string', description: BODY } }, required: ['message'] } };

let captured: unknown[][];
beforeEach(() => {
  captured = [];
  // The SDK retries 429/5xx and transport errors with a backoff; fake only the
  // timer so the retries run at once and the final failure is what is logged.
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => { captured.push(args); });
  }
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

function stubFetch(reply: () => Response | Promise<Response>) {
  const f = vi.fn(async () => reply());
  vi.stubGlobal('fetch', f);
  return f;
}
const providerError = (status: number, type: string = TYPE) =>
  () => new Response(JSON.stringify({ type: 'error', error: { type, message: `${BODY} ${KEY} ${PROMPT}` } }), {
    status, headers: { 'content-type': 'application/json', 'request-id': RID },
  });

async function fail(args: Partial<Parameters<typeof callAgentChatLlm>[0]> = {}): Promise<unknown> {
  const turn = callAgentChatLlm({
    provider: 'anthropic', apiKey: KEY, model: MODEL, systemMessage: PROMPT,
    tools: [RESPOND], messages: [{ role: 'user', content: PROMPT }], ...args,
  }).then(() => { throw new Error('expected the turn to fail'); }, (e: unknown) => e);
  await vi.advanceTimersByTimeAsync(60_000);
  return turn;
}
const lines = () => captured.map((a) => a.map(String).join(' '));
function expectNoSentinel(where: unknown) {
  const text = typeof where === 'string' ? where : JSON.stringify(where) + String(where);
  for (const s of ALL_SENTINELS) expect(text).not.toContain(s);
}
/** Exactly one logger call overall, with exactly one string argument: no stray line, no object to walk. */
function expectOneStringLine() {
  expect(captured).toHaveLength(1);
  expect(captured[0]).toHaveLength(1);
  expect(typeof captured[0][0]).toBe('string');
}
function expectPublicUnchanged(e: unknown, { logged = true }: { logged?: boolean } = {}) {
  if (logged) expectOneStringLine();
  expect(e).toBeInstanceOf(Error);
  expect((e as Error).name).toBe('ChatError');
  expect((e as Error).message).toBe(CHAT_ERROR.llmFailed);
  expect((e as Error).cause).toBeUndefined();
  expect(Object.keys(e as object).sort()).toEqual(Object.keys(new ChatError('llmFailed')).sort()); // no extra field
  expect(publicChatError(e)).toEqual({ code: 'llmFailed', message: CHAT_ERROR.llmFailed, status: 500 });
}

describe('#1979 one closed diagnostic line per failed turn', () => {
  it.each([400, 401, 403, 404, 429, 500])('provider status %i: respond branch, normal turn', async (status) => {
    stubFetch(providerError(status, 'invalid_request_error'));
    const e = await fail();
    expectPublicUnchanged(e);
    const m = LINE.exec(lines()[0]);
    expect(m, lines()[0]).not.toBeNull();
    expect(m!.slice(1)).toEqual(['provider-status', 'request', 'respond', 'forced', 'turn', 'anthropic', String(status), 'invalid_request_error', '1']);
    expectNoSentinel(lines()[0]);
  });

  it('plain branch (no respond tool) on a welcome turn', async () => {
    stubFetch(providerError(401, 'authentication_error'));
    const e = await fail({ tools: null, messages: [] });
    expectPublicUnchanged(e);
    expect(LINE.exec(lines()[0])!.slice(1)).toEqual(['provider-status', 'request', 'plain', 'none', 'welcome', 'anthropic', '401', 'authentication_error', '0']);
  });

  it('an arbitrary provider error type is omitted, never echoed', async () => {
    stubFetch(providerError(400, TYPE));
    expectPublicUnchanged(await fail());
    expect(LINE.exec(lines()[0])![8]).toBe('none');
    expectNoSentinel(lines()[0]);
  });

  it('no status: a transport failure that carries sentinels', async () => {
    stubFetch(() => { throw new TypeError(`fetch failed ${KEY} ${BODY} ${RID}`, { cause: new Error(PROMPT) }); });
    const e = await fail();
    expectPublicUnchanged(e);
    expect(LINE.exec(lines()[0])!.slice(1, 9)).toEqual(['request-failed', 'request', 'respond', 'forced', 'turn', 'anthropic', 'none', 'none']);
    expectNoSentinel(captured);
  });

  it('unexpected tool output: a text-only reply to a forced respond call', async () => {
    stubFetch(() => Response.json({
      id: 'msg_1', type: 'message', role: 'assistant', model: MODEL, stop_reason: 'end_turn',
      content: [{ type: 'text', text: `${BODY} ${PROMPT}` }], usage: { input_tokens: 1, output_tokens: 1 },
    }));
    const e = await fail();
    expectPublicUnchanged(e);
    expect(LINE.exec(lines()[0])!.slice(1)).toEqual(['unexpected-tool-output', 'tool-output', 'respond', 'forced', 'turn', 'anthropic', 'none', 'none', '1']);
    expectNoSentinel(captured);
  });

  it('config: an unsupported provider and an unparsable Bedrock credential', async () => {
    const f = stubFetch(providerError(500));
    const a = await fail({ provider: 'bogus' as never });
    const b = await fail({ provider: 'bedrock', apiKey: `{${KEY}` });
    expect(f).not.toHaveBeenCalled();
    expect(captured).toHaveLength(2);
    for (const e of [a, b]) {
      expect((e as Error).message).toBe(CHAT_ERROR.llmFailed);
      expect(publicChatError(e)).toEqual({ code: 'llmFailed', message: CHAT_ERROR.llmFailed, status: 500 });
    }
    expect(LINE.exec(lines()[0])!.slice(1)).toEqual(['config', 'config', 'respond', 'forced', 'turn', 'unknown', 'none', 'none', '1']);
    expect(LINE.exec(lines()[1])!.slice(1)).toEqual(['config', 'config', 'respond', 'forced', 'turn', 'bedrock', 'none', 'none', '1']);
    expectNoSentinel(captured);
  });

  it.each(['openai', 'glm'] as const)('%s: a rejected call is classified by status, and its error.type is not read as Anthropic’s', async (provider) => {
    stubFetch(providerError(401, 'invalid_request_error'));
    const e = await fail({ provider, model: 'm' });
    expectPublicUnchanged(e);
    expect(LINE.exec(lines()[0])!.slice(1)).toEqual(['provider-status', 'request', 'respond', 'forced', 'turn', provider, '401', 'none', '1']);
    expectNoSentinel(captured);
  });

  it('a successful plain-branch turn logs nothing', async () => {
    stubFetch(() => Response.json({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'm', stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 1, output_tokens: 1 },
    }));
    await expect(callAgentChatLlm({ provider: 'anthropic', apiKey: KEY, model: 'm', systemMessage: 's', tools: null, messages: [{ role: 'user', content: 'x' }] }))
      .resolves.toMatchObject({ respond: { message: 'hi' } });
    expect(captured).toEqual([]);
  });

  it('a successful turn and a refused provider call log nothing', async () => {
    stubFetch(() => Response.json({
      id: 'msg_1', type: 'message', role: 'assistant', model: 'm', stop_reason: 'tool_use',
      content: [{ type: 'tool_use', id: 't1', name: 'respond', input: { message: 'hi' } }], usage: { input_tokens: 1, output_tokens: 1 },
    }));
    await expect(callAgentChatLlm({ provider: 'anthropic', apiKey: KEY, model: 'm', systemMessage: 's', tools: [RESPOND], messages: [{ role: 'user', content: 'x' }] }))
      .resolves.toMatchObject({ respond: { message: 'hi' } });
    expect(captured).toEqual([]);
  });

  it('a logger that throws cannot replace the public error', async () => {
    stubFetch(providerError(500));
    vi.spyOn(console, 'warn').mockImplementation(() => { throw new Error(`logger down ${KEY}`); });
    expectPublicUnchanged(await fail(), { logged: false });
  });
});

describe('#1979 describeLlmFailure never walks an arbitrary error', () => {
  const ctx = { stage: 'request', branch: 'respond', turn: 'turn', provider: 'anthropic', tools: 1, choice: 'forced' } as const;
  const hostile: Array<[string, unknown]> = [
    ['string', `${KEY} ${BODY}`],
    ['null', null],
    ['undefined', undefined],
    ['number', 401],
    ['getter that throws', Object.defineProperty(new Error(PROMPT), 'statusCode', { get() { throw new Error(KEY); } })],
    ['cyclic', (() => { const o: Record<string, unknown> = { name: TYPE, message: BODY }; o.self = o; o.cause = o; return o; })()],
    ['impostor status', { statusCode: 401, name: 'APICallError', message: KEY, data: { error: { type: 'rate_limit_error' } } }],
    ['proxy that throws on any access', new Proxy({}, { get() { throw new Error(KEY); }, has() { throw new Error(KEY); }, ownKeys() { throw new Error(KEY); }, getPrototypeOf() { throw new Error(KEY); } })],
  ];
  it.each(hostile)('%s yields a closed line with no sentinel', (_n, err) => {
    const line = describeLlmFailure(err, ctx);
    expect(line, line).toMatch(LINE);
    expect(line).toContain('status=none');
    expect(line).toContain('type=none');
    expectNoSentinel(line);
  });
  it.each(['stage', 'branch', 'turn', 'provider', 'choice'] as const)('a garbage %s never reaches the line', (field) => {
    for (const bad of [KEY, `${PROMPT}\n[agent-chat] forged`, 'config extra', '', null, undefined, 7, { toString: () => KEY }]) {
      const line = describeLlmFailure(new Error('x'), { ...ctx, [field]: bad } as never);
      expect(line, String(field)).toMatch(LINE);
      expectNoSentinel(line);
      expect(line).not.toContain('\n');
    }
  });
  it('a context that throws while it is built cannot replace the public error', async () => {
    stubFetch(providerError(500));
    // The context is read inside the logging guard: a hostile tools array throws there, not in the caller.
    const hostileTools = new Proxy([], { get() { throw new Error(KEY); } }) as never;
    const turn = callAgentChatLlm({ provider: 'anthropic', apiKey: KEY, model: MODEL, systemMessage: PROMPT, tools: hostileTools, messages: [{ role: 'user', content: PROMPT }] })
      .then(() => { throw new Error('expected failure'); }, (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(60_000);
    const e = await turn;
    expect((e as Error).message).toBe(CHAT_ERROR.llmFailed);
    expect(publicChatError(e)).toEqual({ code: 'llmFailed', message: CHAT_ERROR.llmFailed, status: 500 });
  });
  it('rejects out-of-range or non-integer status values from an unknown shape', () => {
    for (const bad of [99, 600, 1.5, Number.NaN, '401', -1]) {
      expect(describeLlmFailure({ statusCode: bad }, ctx)).toContain('status=none');
    }
  });
  it('a genuine SDK error with a malformed status is still "none"; a good one is kept', () => {
    const call = (statusCode: unknown, data?: unknown) =>
      new APICallError({ message: KEY, url: 'https://x.invalid', requestBodyValues: {}, statusCode: statusCode as number, data });
    for (const bad of [99, 600, 1.5, 401.5, 100.1, Number.NaN, -1, Infinity]) {
      expect(describeLlmFailure(call(bad), ctx)).toContain('status=none');
    }
    expect(describeLlmFailure(call(100), ctx)).toContain('status=100');
    expect(describeLlmFailure(call(599), ctx)).toContain('status=599');
    expect(describeLlmFailure(call(401, { error: { type: 'authentication_error' } }), ctx)).toContain('type=authentication_error');
    expect(describeLlmFailure(call(401, { error: { type: { toString: () => KEY } } }), ctx)).toContain('type=none');
    expect(describeLlmFailure(call(401, { get error() { throw new Error(KEY); } }), ctx)).toMatch(LINE);
  });
  it('an invalid provider or tool count falls back to unknown/0', () => {
    const line = describeLlmFailure(new Error('x'), { ...ctx, provider: MODEL as never, tools: -3 });
    expect(line).toMatch(LINE);
    expect(line).toContain('provider=unknown');
    expect(line).toContain('tools=0');
    expectNoSentinel(line);
  });
});
