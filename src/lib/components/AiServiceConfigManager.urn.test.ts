import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { parse, type FragmentDefinitionNode } from 'graphql';
import AiServiceConfigManager from './AiServiceConfigManager.svelte';
import { managerCallbacks } from '$lib/test/ai-config-manager-callbacks';
import { AI_SERVICE_CONFIG_FIELDS } from '$lib/server/queries';
import { parseAiConfigList } from './ai-config-readback';
import type { AiServiceConfig } from '$lib/types';

const urn = 'hrn:aiconf:acme.com:org:default';
const row = {
  id: 'c1', name: 'default', ownerType: 'ORGANIZATION', ownerId: 'o1', provider: 'glm', model: 'glm-5',
  endpoint: null, effectiveEndpoint: 'https://api.z.ai/api/paas/v4', apiStyle: null, effectiveApiStyle: 'CHAT_COMPLETIONS',
  hasApiKey: true, apiKeyPreview: '…abcd', params: null, enabled: true,
  createdAt: '2026-09-26T00:00:00Z', updatedAt: null,
} as AiServiceConfig;
function html(value: string | null, ownerType: 'ORGANIZATION' | 'APP' | 'AGENT' = 'ORGANIZATION') {
  return render(AiServiceConfigManager, { props: {
    ...managerCallbacks(), ownerType, ownerId: 'o1', currentUserId: 'u1', configs: [{ ...row, urn: value } as AiServiceConfig],
  } }).body;
}

describe('org AI configuration identifiers (#1907)', () => {
  it('renders the server-provided URN with the shared chip under the name', () => {
    const body = html(urn);
    expect(body).toContain(urn);
    expect(body).toContain('Copy AI configuration URN');
    // Display-only: the portal has no canonical aiconf detail route yet.
    expect(body).not.toContain('/app/u/');
    expect(body).not.toContain('Copy AI configuration URL');
  });
  it('renders no chip, copy action or resolver URL for a null URN', () => {
    const body = html(null);
    expect(body).not.toContain('Copy AI configuration URN');
    expect(body).not.toContain('/app/u/');
    expect(body).not.toContain('aiconf');
  });
  it.each(['APP', 'AGENT'] as const)('does not expand the render scope to %s owners', ownerType => {
    expect(html(urn, ownerType)).not.toContain(urn);
  });
  it('rejects malformed URN DTO values rather than passing objects to the chip', () => {
    expect(parseAiConfigList({ configs: [{ ...row, urn: { value: urn } }] })).toBeNull();
  });
  it('selects the field and retains its exact value through committed readback', () => {
    const fragment = parse(AI_SERVICE_CONFIG_FIELDS).definitions.find(d => d.kind === 'FragmentDefinition') as FragmentDefinitionNode;
    expect(fragment.typeCondition.name.value).toBe('AiServiceConfig');
    expect(fragment.selectionSet.selections.some(s => s.kind === 'Field' && s.name.value === 'urn')).toBe(true);
    expect(parseAiConfigList({ configs: [{ ...row, urn }] })?.[0]).toHaveProperty('urn', urn);
    expect(parseAiConfigList({ configs: [{ ...row, urn: null }] })?.[0]).toHaveProperty('urn', null);
  });
});
