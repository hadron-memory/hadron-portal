import type { AIProvider } from './types';

export const AI_PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'anthropic', label: 'Anthropic (Claude)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'glm', label: 'GLM (z.ai)' },
  { value: 'bedrock', label: 'AWS Bedrock' },
];

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  glm: 'glm-4-plus',
  bedrock: 'anthropic.claude-sonnet-4-20250514-v1:0',
};
