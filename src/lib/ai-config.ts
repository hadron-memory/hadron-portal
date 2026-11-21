import type { AIProvider, AiConfigProvider } from './types';
import { t } from './i18n/t';

/**
 * The server's own deadline for one AI-config respond test (#2042): the abort
 * the user must be able to see. The client's network window is derived from
 * this value so it can never fire first (#2054) — shared because the server
 * route and the client helper live on opposite sides of `$lib/server`.
 */
export const AI_CONFIG_TEST_DEADLINE_MS = 20_000;

export const AI_PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'glm', label: 'GLM (z.ai)' },
  { value: 'bedrock', label: 'AWS Bedrock' },
];

/**
 * The AI-config picker's providers: the portal's own, plus server#1389's
 * `openai-compatible`, a host the operator names by endpoint (vLLM, Ollama,
 * OpenRouter …). Only configs may name it; the portal's own client can't.
 */
export const AI_CONFIG_PROVIDERS: { value: AiConfigProvider; label: string }[] = [
  ...AI_PROVIDERS,
  // Unlike the brand names above, this label is words, so it is translatable.
  { value: 'openai-compatible', label: t('ai-config.provider.openai-compatible', 'OpenAI-compatible (your endpoint)') },
  // hadron-portal#2138: a config-only provider like the one above. A brand
  // name, so it is not translated. The server serves it; AIProvider stays
  // kimi-free because the portal's own LLM client never does.
  { value: 'kimi', label: 'Kimi (Moonshot)' },
];

/**
 * What the form pre-fills in the model field for a config-only provider. An
 * editable starting point only: the portal never validates, normalises or
 * rewrites a model string, and the server passes it through verbatim.
 */
export const CONFIG_ONLY_DEFAULT_MODELS: Partial<Record<AiConfigProvider, string>> = {
  kimi: 'kimi-k3',
};

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  glm: 'glm-4-plus',
  bedrock: 'anthropic.claude-sonnet-4-20250514-v1:0',
};
