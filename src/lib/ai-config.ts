import type { AIProvider, StationAIConfig } from './types';

const STORAGE_KEY_PREFIX = 'hadron-ai-config-';

export const AI_PROVIDERS: { value: AIProvider; label: string }[] = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
  { value: 'xai', label: 'xAI (Grok)' },
  { value: 'glm', label: 'GLM Coding (z.ai)' },
];

export const DEFAULT_MODELS: Record<AIProvider, string> = {
  openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-20250514',
  google: 'gemini-2.0-flash',
  xai: 'grok-3',
  glm: 'glm-4-plus',
};

export function loadAIConfig(stationId: string): StationAIConfig | null {
  if (typeof localStorage === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY_PREFIX + stationId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StationAIConfig;
  } catch {
    return null;
  }
}

export function saveAIConfig(stationId: string, config: StationAIConfig): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY_PREFIX + stationId, JSON.stringify(config));
}

export function clearAIConfig(stationId: string): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_PREFIX + stationId);
}
