/**
 * #2049: pin the two guards of #2032's inline respond probe that no test reached.
 *
 *  1. The probe's one-request bound (`maxRetries: 0`, an abort signal) is spread in
 *     ONLY for `respondTest`. An ordinary chat turn keeps the SDK's retry and has no
 *     deadline signal. Mutant: the spread predicate `args.respondTest` -> `true`.
 *  2. `respondTest` with no respond tool closes as `llmFailed` BEFORE the plain
 *     branch, so no provider request is made. Mutant: remove the guard.
 *
 * The real locked SDK over an intercepted fetch with a SYNTHETIC key; no provider call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAgentChatLlm, type HadronTool } from './agentChatLlm.js';
import { publicChatError } from './chatError.js';

const KEY = 'sk-ant-api03-SYNTHETIC2049probeKEYabcdef0123456789';
const MODEL = 'claude-sonnet-5-5';
const RESPOND: HadronTool = {
  name: 'respond',
  description: 'Respond to the user',
  parameters: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
};
const MESSAGES = [{ role: 'user' as const, content: 'hello' }];

type Seen = { signal: unknown };
let seen: Seen[];
let reply: () => Response;

const ok = () => Response.json({
  id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use',
  content: [{ type: 'tool_use', id: 't1', name: 'respond', input: { message: 'hi' } }],
  usage: { input_tokens: 1, output_tokens: 1 },
});
const overloaded = () => new Response(
  JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'x' } }),
  { status: 529, headers: { 'content-type': 'application/json' } },
);

beforeEach(() => {
  seen = [];
  reply = ok;
  // The SDK retries 5xx with a backoff: fake only the timer so retries run at once.
  vi.useFakeTimers({ toFake: ['setTimeout'] });
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
    seen.push({ signal: init?.signal });
    return reply();
  }));
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation(() => {});
  }
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

/** Advance the faked timer until the turn settles. Bounded, so a turn that never settles fails here. */
async function settle<T>(turn: Promise<T>): Promise<void> {
  let done = false;
  void turn.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 600 && !done; i++) await vi.advanceTimersByTimeAsync(1_000);
  if (!done) throw new Error('the turn never settled');
}

const call = (extra: { respondTest?: true; tools?: HadronTool[] | null } = {}) =>
  callAgentChatLlm({
    provider: 'anthropic', apiKey: KEY, model: MODEL, systemMessage: 'stage prompt',
    tools: extra.tools === undefined ? [RESPOND] : extra.tools, messages: MESSAGES,
    ...(extra.respondTest ? { respondTest: true as const } : {}),
  });

describe('#2049 the probe bounds reach only the probe', () => {
  it('a failing ordinary chat call is retried by the SDK; the probe is not (one request)', async () => {
    reply = overloaded;
    const ordinary = call().catch((e: unknown) => e);
    await settle(ordinary);
    const ordinaryRequests = seen.length;
    seen = [];
    const probe = call({ respondTest: true }).catch((e: unknown) => e);
    await settle(probe);
    expect(seen).toHaveLength(1); // the probe: one bounded request, no SDK retry
    expect(ordinaryRequests).toBeGreaterThan(1); // control: ordinary chat keeps the SDK's retry
  });

  it('the probe request carries the deadline abort signal; an ordinary request carries none', async () => {
    await call();
    expect(seen).toHaveLength(1);
    expect(seen[0].signal).toBeUndefined();
    seen = [];
    await call({ respondTest: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].signal).toBeInstanceOf(AbortSignal); // control: the same harness does see a signal
  });
});

describe('#2049 respondTest with no respond tool closes before the plain branch', () => {
  it.each([
    ['tools null', null],
    ['no tools', []],
    ['only a tool that is not respond', [{ ...RESPOND, name: 'other' }]],
  ] as const)('%s: llmFailed, and no provider request is made', async (_t, tools) => {
    const e = await call({ respondTest: true, tools: tools as HadronTool[] | null }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(Error);
    expect(publicChatError(e).code).toBe('llmFailed');
    expect(seen).toHaveLength(0); // the plain branch would have sent one
  });

  it('control: the same no-tool call without respondTest takes the plain branch (one request)', async () => {
    await call({ tools: null });
    expect(seen).toHaveLength(1);
  });
});
