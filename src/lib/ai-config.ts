import type { AIProvider, StationAIConfig } from './types';

const STORAGE_KEY = 'hadron-ai-config';

export const AI_PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'glm', label: 'GLM (z.ai)' },
];

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o',
  glm: 'glm-4-plus',
};

export function loadAIConfig(): StationAIConfig | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StationAIConfig;
  } catch {
    return null;
  }
}

export function saveAIConfig(config: StationAIConfig): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

export function clearAIConfig(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY);
}
