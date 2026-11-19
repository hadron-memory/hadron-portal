import { beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { RESOLVE_AI_CONFIG_QUERY } from '$lib/server/queries';

const { request, construct, generate } = vi.hoisted(() => ({
  request: vi.fn(), construct: vi.fn(), generate: vi.fn(),
}));
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/llm/agentChatLlm.js', async () => {
  const actual = await vi.importActual<typeof import('$lib/server/llm/agentChatLlm.js')>('$lib/server/llm/agentChatLlm.js');
  return { ...actual, createLanguageModel: construct };
});
vi.mock('ai', async () => ({ ...await vi.importActual('ai'), generateText: generate }));
const { judgeAgentReply } = await import('./llm-judge');

beforeEach(() => { request.mockReset(); construct.mockReset(); generate.mockReset(); });

it.each([
  ['anthropic', 'https://api.anthropic.com/v1'], ['openai', 'https://api.openai.com/v1'],
  ['glm', 'https://api.z.ai/api/paas/v4'], ['bedrock', null],
])('judge %s refuses before SDK model construction', async (provider, effectiveEndpoint) => {
  request.mockResolvedValue({ resolveAIConfig: { provider, effectiveEndpoint, apiKey: null, model: 'synthetic' } });
  const result = await judgeAgentReply({ token: 'test', agentId: 'agent', reply: 'hello', criterion: 'greet' });
  expect(result).toEqual({ score: null, rationale: 'judge unreachable (credentialUnavailable)' });
  expect(request.mock.calls[0][0]).toBe(RESOLVE_AI_CONFIG_QUERY);
  expect(construct).not.toHaveBeenCalled();
  expect(generate).not.toHaveBeenCalled();
});

it('authorized judge still constructs a model and evaluates', async () => {
  request.mockResolvedValue({ resolveAIConfig: {
    provider: 'anthropic', effectiveEndpoint: 'https://api.anthropic.com/v1', apiKey: 'synthetic-allowed', model: 'synthetic',
  } });
  construct.mockReturnValue({ synthetic: true });
  generate.mockResolvedValue({ text: '{"score":1,"rationale":"greeted"}' });
  expect(await judgeAgentReply({ token: 'test', agentId: 'agent', reply: 'hello', criterion: 'greet' })).toEqual({ score: 1, rationale: 'greeted' });
  expect(construct).toHaveBeenCalledWith('anthropic', 'synthetic-allowed', 'synthetic');
  expect(generate).toHaveBeenCalledTimes(1);
});

it('fixture runner wires both turns through the common checked resolution', () => {
  // Wiring proof supplements dynamic entrypoint coverage: the runner resolves once
  // and passes that exact outcome to runChatTurn; it has no independent model factory.
  const source = readFileSync('src/routes/api/agent-chat/fixtures/run/+server.ts', 'utf8');
  expect(source).toMatch(/const ai = await resolveChatAi\(token, agentId\)/);
  expect(source).toMatch(/userMessage: null, ai,/);
  expect(source).toMatch(/userMessage: turn.user, ai \}/);
  expect(source).not.toMatch(/createLanguageModel|createAnthropic|createOpenAI|createAmazonBedrock/);
});
