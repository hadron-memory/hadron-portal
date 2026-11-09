import { mount } from 'svelte';
import AiServiceConfigManager from '$lib/components/AiServiceConfigManager.svelte';
import type { AiServiceConfig } from '$lib/types';

/** Synthetic rows; the real manager, grid and menu own all rendering/interaction. */
export function mountAiConfigRows(target: HTMLElement, enabled: boolean) {
  const configs: AiServiceConfig[] = Array.from({ length: 45 }, (_, i) => ({
    id: `config-${i}`, name: `config-${String(i).padStart(2, '0')}`,
    ownerType: 'APP', ownerId: 'fixture-app', provider: 'anthropic', model: 'fixture-model',
    endpoint: null, effectiveEndpoint: 'https://example.invalid', apiStyle: null, effectiveApiStyle: null,
    hasApiKey: true, apiKeyPreview: '…test', params: null, enabled,
    createdAt: '2026-11-01T00:00:00Z', updatedAt: null,
  }));
  return mount(AiServiceConfigManager, { target, props: { ownerType: 'APP', ownerId: 'fixture-app', configs, canManage: true } });
}
