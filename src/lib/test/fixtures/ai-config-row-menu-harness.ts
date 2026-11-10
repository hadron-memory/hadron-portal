import { mount } from 'svelte';
import AiServiceConfigManager from '$lib/components/AiServiceConfigManager.svelte';
import type { AiServiceConfig } from '$lib/types';

export type AiConfigRowMode = 'enabled' | 'disabled' | 'mixed';
/** In `mixed`, config-01..03 are adjacent disabled rows and config-04 is the enabled row after them (#1874). */
export const mixedRowEnabled = (i: number) => !(i >= 1 && i <= 3) && i % 2 === 0;

/** Synthetic rows; the real manager, grid and menu own all rendering/interaction. */
export function mountAiConfigRows(target: HTMLElement, mode: AiConfigRowMode) {
  const configs: AiServiceConfig[] = Array.from({ length: 45 }, (_, i) => ({
    id: `config-${i}`, name: `config-${String(i).padStart(2, '0')}`,
    ownerType: 'APP', ownerId: 'fixture-app', provider: 'anthropic', model: 'fixture-model',
    endpoint: null, effectiveEndpoint: 'https://example.invalid', apiStyle: null, effectiveApiStyle: null,
    hasApiKey: true, apiKeyPreview: '…test', params: null, enabled: mode === 'mixed' ? mixedRowEnabled(i) : mode === 'enabled',
    createdAt: '2026-11-01T00:00:00Z', updatedAt: null,
  }));
  return mount(AiServiceConfigManager, { target, props: { ownerType: 'APP', ownerId: 'fixture-app', currentUserId: 'fixture-user', configs, canManage: true } });
}
