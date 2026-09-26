import type { AIProvider, AiConfigProvider } from './types';

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
  { value: 'openai-compatible', label: 'OpenAI-compatible (your endpoint)' },
];

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  glm: 'glm-4-plus',
  bedrock: 'anthropic.claude-sonnet-4-20250514-v1:0',
};
