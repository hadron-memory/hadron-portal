/** #2031: real locked Bedrock SDK, synthetic credentials, intercepted transport only. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callAgentChatLlm, RESPOND_ONCE_INSTRUCTION, usesAutoToolChoice, type HadronTool } from './agentChatLlm.js';
import { publicChatError } from './chatError.js';

// AWS model-card Programmatic Access tables, read 2026-11-12. No derived aliases.
const LISTED = [
  'anthropic.claude-sonnet-5-5', 'us.anthropic.claude-sonnet-5-5',
  'eu.anthropic.claude-sonnet-5-5', 'au.anthropic.claude-sonnet-5-5', 'global.anthropic.claude-sonnet-5-5',
  'anthropic.claude-opus-5-5', 'us.anthropic.claude-opus-5-5', 'eu.anthropic.claude-opus-5-5',
  'au.anthropic.claude-opus-5-5', 'jp.anthropic.claude-opus-5-5', 'global.anthropic.claude-opus-5-5',
  'anthropic.claude-fable-5-2', 'us.anthropic.claude-fable-5-2', 'global.anthropic.claude-fable-5-2',
];
const KEY = JSON.stringify({ accessKeyId: 'SYNTHETIC2031', secretAccessKey: 'synthetic-secret-2031', region: 'us-east-1' });
// Same open server schema as the #2030 fixture: no narrowing, extra properties or strict.
const SCHEMA = {
  type: 'object', properties: {
    message: { type: 'string', description: 'Your response to the user' },
    data: { type: 'object', properties: { goal: { type: 'string', description: 'goal' } } },
    next_stage: { type: ['string', 'null'], description: 'Stage to transition to (null to stay in current stage)' },
    onTrack: { type: 'boolean', description: 'Is the current conversation/stage still the right fit for what the user is asking?' },
    offTrackReason: { type: 'string', description: 'If onTrack is false, explain why the conversation seems off-track' },
  }, required: ['message', 'onTrack'],
};
const TOOLS: HadronTool[] = [{ name: 'respond', description: 'Respond to the user and extract data', parameters: SCHEMA }];
const input = { message: 'fixture', onTrack: true, data: { undeclared: 42 }, next_stage: 'arbitrary' };
const toolUse = (value: unknown = input, name = 'respond') => ({ toolUse: { toolUseId: 'fixture', name, input: value } });
const reply = (content: unknown[]) => Response.json({ output: { message: { role: 'assistant', content } }, stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } });
let bodies: any[], paths: string[], logs: unknown[][], response: () => Response;
beforeEach(() => {
  bodies = []; paths = []; logs = []; response = () => reply([toolUse()]);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    paths.push(decodeURIComponent(new URL(url).pathname)); bodies.push(JSON.parse(String(init?.body))); return response();
  }));
  vi.spyOn(console, 'warn').mockImplementation((...args) => { logs.push(args); });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const call = (model: string, messages: Array<{ role: 'user' | 'assistant'; content: string }> = [], tools: HadronTool[] | null = TOOLS) => callAgentChatLlm({ provider: 'bedrock', apiKey: KEY, model, systemMessage: 'Stage prompt', tools, messages });

describe.each(LISTED)('%s Bedrock wire', model => {
  it.each([{ messages: [] }, { messages: [{ role: 'user' as const, content: 'hello' }] }])('auto request in welcome/history %#', async ({ messages }) => {
    const toolsBefore = JSON.stringify(TOOLS);
    expect((await call(model, messages)).respond).toEqual(input);
    expect(paths).toEqual([`/model/${model}/converse`]);
    expect(bodies[0].toolConfig.toolChoice).toEqual({ auto: {} });
    expect(usesAutoToolChoice('bedrock', model)).toBe(true);
    expect(bodies[0].toolConfig.tools).toEqual([{ toolSpec: { name: 'respond', description: TOOLS[0].description, inputSchema: { json: SCHEMA } } }]);
    expect(bodies[0].system).toEqual([{ text: `Stage prompt\n\n${RESPOND_ONCE_INSTRUCTION}` }]);
    expect(JSON.stringify(TOOLS)).toBe(toolsBefore);
    await call(model, messages);
    expect(bodies[1]).toEqual(bodies[0]); // no instruction accumulation
  });
});

it.each(['claude-sonnet-5-5', 'jp.anthropic.claude-sonnet-5-5', 'eu.anthropic.claude-fable-5-2', 'anthropic.claude-sonnet-5-5-x', 'ANTHROPIC.CLAUDE-SONNET-5-5', 'anthropic.claude-haiku-5-5', 'anthropic.claude-fable-5-1', 'arn:aws:bedrock:us-east-1:000000000000:application-inference-profile/synthetic'])('unlisted %s stays forced and verbatim', async model => {
  expect(usesAutoToolChoice('bedrock', model)).toBe(false);
  await call(model);
  expect(paths).toEqual([`/model/${model}/converse`]);
  expect(bodies[0].toolConfig.toolChoice).toEqual({ tool: { name: 'respond' } });
  expect(bodies[0].system).toEqual([{ text: 'Stage prompt' }]);
});
it.each(['anthropic', 'openai', 'glm'] as const)('Bedrock IDs do not opt %s in', provider => {
  for (const model of LISTED) expect(usesAutoToolChoice(provider, model)).toBe(false);
});
it('no respond tool keeps the plain branch and prompt unchanged', async () => {
  response = () => reply([{ text: 'plain fixture' }]);
  await call(LISTED[0], [], null);
  expect(bodies[0]).not.toHaveProperty('toolConfig');
  expect(bodies[0].system).toEqual([{ text: 'Stage prompt' }]);
});
it.each(['text', 'other', 'empty', '400'])('%s failure closes without text/key exposure', async kind => {
  response = () => kind === '400' ? Response.json({ message: `synthetic-secret-2031 RAW_PROVIDER_TEXT` }, { status: 400 })
    : reply(kind === 'text' ? [{ text: 'RAW_MODEL_TEXT synthetic-secret-2031' }] : kind === 'other' ? [toolUse({}, 'other')] : []);
  const error = await call(LISTED[0]).catch(e => e);
  expect(publicChatError(error).code).toBe('llmFailed');
  expect(bodies).toHaveLength(1);
  expect(logs).toHaveLength(1);
  expect(String(error)).not.toMatch(/synthetic-secret-2031|RAW_PROVIDER_TEXT|RAW_MODEL_TEXT/);
  expect(JSON.stringify([error, logs])).not.toMatch(/synthetic-secret-2031|RAW_PROVIDER_TEXT|RAW_MODEL_TEXT/);
});
it('two calls and malformed input keep the merged baseline', async () => {
  response = () => reply([toolUse({ message: 'first' }), toolUse({ message: 'second' })]);
  expect((await call(LISTED[0])).respond).toEqual({ message: 'first' });
  response = () => reply([toolUse({ data: 'unvalidated' })]);
  expect((await call(LISTED[0])).respond).toEqual({ data: 'unvalidated' });
});
