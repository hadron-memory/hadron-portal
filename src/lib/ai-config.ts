import type { AIProvider } from './types';

export const AI_PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'glm', label: 'GLM (z.ai)' },
];

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o',
  glm: 'glm-4-plus',
};
