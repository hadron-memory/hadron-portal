import { describe, expect, it } from 'vitest';
import { parseAiConfigList } from './ai-config-readback';

const masked = {
  id: 'c1', name: 'default', ownerType: 'AGENT', ownerId: 'a1', provider: 'glm', model: 'glm-5',
  endpoint: null, effectiveEndpoint: 'https://api.z.ai/api/paas/v4',
  apiStyle: null, effectiveApiStyle: 'CHAT_COMPLETIONS',
  hasApiKey: true, apiKeyPreview: '…abcd', params: null, enabled: true,
  createdAt: '2026-09-26T00:00:00Z', updatedAt: null,
};

describe('AI configuration readback parser', () => {
  it('drops fields outside the fixed masked DTO instead of forwarding them', () => {
    const parsed = parseAiConfigList({
      configs: [{
        ...masked,
        apiKey: 'sk-synthetic-must-not-survive',
        authorization: 'Bearer synthetic-must-not-survive',
        unexpected: { credential: 'synthetic-must-not-survive' },
      }],
    });

    expect(parsed).toEqual([masked]);
    expect(JSON.stringify(parsed)).not.toContain('synthetic-must-not-survive');
  });
});
