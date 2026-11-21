/**
 * #1979 remedy: server AUTO decisions preserve the former auto request and output baseline.
 *
 * The real locked SDK over an intercepted fetch with a SYNTHETIC key. A fixture
 * models request compatibility; it is NOT proof the provider accepts the
 * request (that is the separately granted live corroboration).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESPOND_ONCE_INSTRUCTION, callAgentChatLlm, type HadronTool } from './agentChatLlm.js';
import { CHAT_ERROR, publicChatError } from './chatError.js';

const KEY = 'sk-ant-api03-SYNTHETIC1979remedyKEYabcdef0123456789';
const LISTED = ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'] as const;

// The shape of the server's buildRespondToolSchema output (hadron-server
// resolvers.helpers.ts, origin/main): outer and `data` objects are OPEN, extraction
// fields keyed by their last dotted segment, optional fields, no enum on next_stage.
const SERVER_SCHEMA = {
  type: 'object',
  properties: {
    message: { type: 'string', description: 'Your response to the user' },
    data: {
      type: 'object',
      properties: {
        goal: { type: 'string', description: 'goal' },
        age: { type: 'number', description: 'age' },
        topics: { type: 'array', description: 'topics' },
      },
    },
    next_stage: { type: ['string', 'null'], description: 'Stage to transition to (null to stay in current stage)' },
    onTrack: { type: 'boolean', description: 'Is the current conversation/stage still the right fit for what the user is asking?' },
    offTrackReason: { type: 'string', description: 'If onTrack is false, explain why the conversation seems off-track' },
  },
  required: ['message', 'onTrack'],
};
const TOOLS: HadronTool[] = [{ name: 'respond', description: 'Respond to the user and extract data', parameters: SERVER_SCHEMA }];
const HISTORY = [
  { role: 'user' as const, content: 'hello' },
  { role: 'assistant' as const, content: 'hi there' },
  { role: 'user' as const, content: 'I want to learn' },
];
const STAGE_SYSTEM = 'You are the stage prompt.';

type Block = Record<string, unknown>;
const toolUse = (input: unknown, name = 'respond'): Block => ({ type: 'tool_use', id: `t_${Math.random()}`, name, input });
const reply = (content: Block[]) => Response.json({
  id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', content,
  usage: { input_tokens: 1, output_tokens: 1 },
});

let bodies: Array<Record<string, any>>;
let logged: unknown[][];
let next: () => Response;
beforeEach(() => {
  bodies = [];
  logged = [];
  next = () => reply([toolUse({ message: 'hi', onTrack: true })]);
  vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return next();
  }));
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...a: unknown[]) => { logged.push(a); });
  }
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const call = (model: string, provider: 'anthropic' | 'openai' | 'glm' = 'anthropic', messages = HISTORY, tools: HadronTool[] | null = TOOLS, toolChoice: 'AUTO' | 'FORCED' = 'AUTO') =>
  callAgentChatLlm({ provider, apiKey: KEY, model, systemMessage: STAGE_SYSTEM, tools, messages, toolChoice });

describe.each(LISTED)('%s: request on the wire', (model) => {
  it.each([['welcome', []], ['history', HISTORY]] as const)('%s turn sends auto, the schema byte-for-byte, the model verbatim', async (_t, messages) => {
    await call(model, 'anthropic', [...messages]);
    expect(bodies).toHaveLength(1);
    const b = bodies[0];
    expect(b.tool_choice).toEqual({ type: 'auto' });
    expect(b.model).toBe(model);
    expect(b.tools).toHaveLength(1);
    expect(b.tools[0].name).toBe('respond');
    expect(b.tools[0].input_schema).toEqual(SERVER_SCHEMA);
    expect(JSON.stringify(b.tools[0].input_schema)).toBe(JSON.stringify(SERVER_SCHEMA));
    expect(b.tools[0]).not.toHaveProperty('strict');
    expect(JSON.stringify(b.tools[0].input_schema)).not.toContain('additionalProperties');
  });

  it('appends the instruction to the system text for this turn only', async () => {
    await call(model);
    const system = bodies[0].system;
    const text = typeof system === 'string' ? system : system.map((s: { text: string }) => s.text).join('');
    expect(text).toBe(`${STAGE_SYSTEM}\n\n${RESPOND_ONCE_INSTRUCTION}`);
    await call(model);
    expect(bodies[1].system).toEqual(bodies[0].system); // not accumulated across turns
  });

  it('an empty stage prompt yields just the instruction (no degenerate block)', async () => {
    await callAgentChatLlm({ provider: 'anthropic', apiKey: KEY, model, systemMessage: '  \n', tools: TOOLS, messages: HISTORY, toolChoice: 'AUTO' });
    const system = bodies[0].system;
    const text = typeof system === 'string' ? system : system.map((s: { text: string }) => s.text).join('');
    expect(text).toBe(RESPOND_ONCE_INSTRUCTION);
  });

  it('the plain branch (no respond tool) is untouched: no tools, no tool_choice, no instruction', async () => {
    next = () => reply([{ type: 'text', text: 'hi' }]);
    await call(model, 'anthropic', HISTORY, null);
    expect(bodies[0]).not.toHaveProperty('tools');
    expect(bodies[0]).not.toHaveProperty('tool_choice');
    expect(JSON.stringify(bodies[0].system)).not.toContain(RESPOND_ONCE_INSTRUCTION);
  });
});

describe('controls keep today\'s forced request', () => {
  it('claude-haiku-5-5 (accepts a forced choice) stays forced, no instruction', async () => {
    await call('claude-haiku-5-5', 'anthropic', HISTORY, TOOLS, 'FORCED');
    expect(bodies[0].tool_choice).toEqual({ type: 'tool', name: 'respond' });
    expect(bodies[0].tools[0].input_schema).toEqual(SERVER_SCHEMA);
    expect(JSON.stringify(bodies[0].system)).not.toContain(RESPOND_ONCE_INSTRUCTION);
    expect(JSON.stringify(bodies[0].system)).toContain(STAGE_SYSTEM);
  });

  it.each([['openai', 'gpt-4o'], ['glm', 'glm-4.6'], ['openai', 'claude-sonnet-5-5']] as const)('%s / %s: never auto, no instruction', async (provider, model) => {
    next = () => new Response('{}', { status: 400 });
    await call(model, provider, HISTORY, TOOLS, 'FORCED').catch(() => undefined);
    expect(bodies).toHaveLength(1);
    const wire = JSON.stringify(bodies[0]);
    expect(JSON.stringify(bodies[0].tool_choice)).not.toContain('auto');
    expect(JSON.stringify(bodies[0].tool_choice)).toContain('respond');
    expect(wire).not.toContain(RESPOND_ONCE_INSTRUCTION);
  });
});

describe.each(LISTED)('%s: output handling is the existing baseline', (model) => {
  it('a valid reply, undeclared data keys and stage strings pass through intact', async () => {
    const input = { message: 'hello', onTrack: true, next_stage: 'any-stage-string', data: { goal: 'x', undeclared: { a: 1 } }, offTrackReason: 'r' };
    next = () => reply([toolUse(input)]);
    const r = await call(model);
    expect(r.respond).toEqual(input);
  });

  it('text only → closed llmFailed, one request, no retry or fallback', async () => {
    next = () => reply([{ type: 'text', text: 'I will answer in prose, SECRETMODELTEXT' }]);
    const e = await call(model).catch((x) => x);
    expect(publicChatError(e)).toEqual({ code: 'llmFailed', message: CHAT_ERROR.llmFailed, status: 500 });
    expect(bodies).toHaveLength(1);
  });

  it('empty content → closed llmFailed', async () => {
    next = () => reply([]);
    expect(publicChatError(await call(model).catch((x) => x)).code).toBe('llmFailed');
    expect(bodies).toHaveLength(1);
  });

  it('a call to another tool → closed llmFailed', async () => {
    next = () => reply([toolUse({ message: 'x', onTrack: true }, 'other_tool')]);
    expect(publicChatError(await call(model).catch((x) => x)).code).toBe('llmFailed');
  });

  it('two respond calls: the first wins (the existing baseline, not a new rule)', async () => {
    next = () => reply([toolUse({ message: 'first', onTrack: true }), toolUse({ message: 'second', onTrack: true })]);
    expect((await call(model)).respond.message).toBe('first');
  });

  it('malformed input passes through unvalidated (the server casts it); no new refusal', async () => {
    const malformed = { onTrack: 'yes', data: 'not an object' };
    next = () => reply([toolUse(malformed)]);
    expect((await call(model)).respond).toEqual(malformed);
    next = () => reply([toolUse({ message: 42 })]);
    expect((await call(model)).respond).toEqual({ message: 42 });
  });
});

describe('error paths expose no key, provider text, cause or model text', () => {
  it.each(LISTED)('%s: a provider 400 and a text-only reply', async (model) => {
    const message = `bad request ${KEY} Bearer ${KEY}`;
    for (const make of [
      () => new Response(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message } }), { status: 400, headers: { 'content-type': 'application/json' } }),
      () => reply([{ type: 'text', text: `prose ${KEY} SECRETMODELTEXT` }]),
    ]) {
      next = make;
      logged = [];
      const e = await call(model).catch((x) => x);
      expect(publicChatError(e)).toEqual({ code: 'llmFailed', message: CHAT_ERROR.llmFailed, status: 500 });
      const everything = [String(e), JSON.stringify(e), String((e as { cause?: unknown }).cause ?? ''), ...logged.map((a) => a.map(String).join(' '))].join('\n');
      for (const bit of [KEY, 'SECRETMODELTEXT', 'bad request', 'Bearer']) expect(everything).not.toContain(bit);
    }
  });
});

// #2036 (a): the failed-turn line says whether the turn ran under auto, and an auto turn with no
// respond call has its own closed class, so the rate the auto choice costs is countable.
describe('#2036 the failed-turn line names the choice', () => {
  const lineOf = () => logged.map((a) => a.map(String).join(' ')).filter((l) => l.includes('[agent-chat] llm turn failed'));
  const PROSE = 'prose SECRETMODELTEXT2036';

  it('auto + prose reply: class=auto-no-respond choice=auto, still llmFailed after exactly one request', async () => {
    next = () => reply([{ type: 'text', text: PROSE }]);
    const e = await call('claude-sonnet-5-5').catch((x) => x);
    expect(publicChatError(e)).toEqual({ code: 'llmFailed', message: CHAT_ERROR.llmFailed, status: 500 });
    expect(bodies).toHaveLength(1);
    const lines = lineOf();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('class=auto-no-respond');
    expect(lines[0]).toContain('stage=tool-output');
    expect(lines[0]).toContain('choice=auto');
  });

  it('forced + prose reply: the existing unexpected-tool-output class, choice=forced, no new token', async () => {
    next = () => reply([{ type: 'text', text: PROSE }]);
    const e = await call('claude-sonnet-5-5', 'anthropic', HISTORY, TOOLS, 'FORCED').catch((x) => x);
    expect(publicChatError(e).code).toBe('llmFailed');
    const lines = lineOf();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('class=unexpected-tool-output');
    expect(lines[0]).toContain('choice=forced');
    expect(lines[0]).not.toContain('auto-no-respond');
  });

  it('the line carries no model text', async () => {
    for (const choice of ['AUTO', 'FORCED'] as const) {
      next = () => reply([{ type: 'text', text: PROSE }]);
      logged = [];
      await call('claude-sonnet-5-5', 'anthropic', HISTORY, TOOLS, choice).catch((x) => x);
      const everything = lineOf().join('\n');
      expect(everything).not.toContain('SECRETMODELTEXT2036');
      expect(everything).not.toContain('prose');
    }
  });
});
