import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { managerCallbacks } from '$lib/test/ai-config-manager-callbacks';
import AiServiceConfigManager from './AiServiceConfigManager.svelte';
import type { AiServiceConfig } from '$lib/types';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });
const config = (id: string, name: string, urn: string | null): AiServiceConfig => ({
  id, name, urn, ownerType: 'ORGANIZATION', ownerId: 'o1', provider: 'glm', model: 'glm-5',
  endpoint: null, effectiveEndpoint: 'https://api.z.ai/api/paas/v4', apiStyle: null, effectiveApiStyle: 'CHAT_COMPLETIONS',
  hasApiKey: true, apiKeyPreview: '…abcd', params: null, enabled: true, createdAt: '2026-09-26T00:00:00Z', updatedAt: null,
});
describe('visible AI config URNs are searchable (#1907)', () => {
  it.each(['ORGANIZATION', 'APP'] as const)('matches only a chip actually rendered for %s', async ownerType => {
    const urn = 'hrn:aiconf:acme.com:org:default';
    mounted = mountComponent(AiServiceConfigManager as never, { ...managerCallbacks(), ownerType, ownerId: 'o1', currentUserId: 'u1', configs: [config('c1', 'default', urn), config('c2', 'other', null)] } as never) as Mounted<Record<string, unknown>>;
    await tick();
    expect(mounted.target.querySelectorAll('tbody tr')).toHaveLength(2);
    const search = mounted.target.querySelector<HTMLInputElement>('input[placeholder]')!;
    for (const name of ['default', 'other']) {
      search.value = name;
      search.dispatchEvent(new Event('input', { bubbles: true }));
      flushSync();
      await tick();
      const rows = [...mounted.target.querySelectorAll('tbody tr')];
      expect(rows).toHaveLength(1);
      expect(rows[0].textContent).toContain(name);
    }
    search.value = urn;
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await tick();
    const names = [...mounted.target.querySelectorAll('tbody tr')].map(row => row.textContent);
    if (ownerType === 'ORGANIZATION') {
      expect(names).toHaveLength(1);
      expect(names[0]).toContain('default');
      expect(names[0]).not.toContain('other');
    } else {
      expect(names).toHaveLength(0);
      expect(names.join(' ')).not.toContain('default');
      expect(names.join(' ')).not.toContain('other');
    }
  });
});
