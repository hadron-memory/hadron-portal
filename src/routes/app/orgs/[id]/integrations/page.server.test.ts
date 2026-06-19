/**
 * Tests for the Integrations-tab loader (#336). AI service configs moved here
 * from the standalone /ai-configs route; the admin-gated failure path that used
 * to be covered on the org-detail loader lives here now.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_SERVICE_CONFIGS_QUERY } from '$lib/server/queries';

// `$env/dynamic/private` is a SvelteKit virtual module; vitest skips the
// SvelteKit plugin. The integrations +page.server.ts imports `env` for the
// `connectExchange` action — these load() tests don't exercise it.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

const fakeOrg = { id: 'org-id-123', name: 'Acme', urn: 'urn:org:acme', members: [] };
const fakeAiConfigs = [
  { id: 'cfg-1', name: 'bedrock-mm', ownerType: 'ORGANIZATION', ownerId: 'org-id-123', provider: 'bedrock', model: 'us.anthropic.claude-sonnet-4-6', hasApiKey: true, apiKeyPreview: '…', params: {}, enabled: true, createdAt: '2026-06-15', updatedAt: '2026-06-15' },
];

// The org comes from parent() (loaded by +layout.server.ts), so only
// AI_SERVICE_CONFIGS_QUERY reaches the client here.
function ev(opts: { orgId?: string; userId?: string } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: 'test-token', user: { id: opts.userId ?? 'user-1' } },
    parent: async () => ({ org: fakeOrg }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

function routeMock(opts: { aiConfigs?: { data?: unknown; error?: unknown } }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === AI_SERVICE_CONFIGS_QUERY) {
      if (opts.aiConfigs?.error !== undefined) throw opts.aiConfigs.error;
      return opts.aiConfigs?.data ?? { aiServiceConfigs: [] };
    }
    throw new Error('Unexpected query passed to mockRequest');
  });
}

describe('Integrations load()', () => {
  it('happy path → returns { org, configs, configsError: false, currentUserId }', async () => {
    routeMock({ aiConfigs: { data: { aiServiceConfigs: fakeAiConfigs } } });
    const load = await importLoad();
    const result = await load(ev({}));
    expect(result).toEqual({
      org: fakeOrg,
      configs: fakeAiConfigs,
      configsError: false,
      currentUserId: 'user-1',
    });
  });

  it('ai-configs query fails (admin-gated; non-admin viewer) → empty configs + configsError', async () => {
    routeMock({ aiConfigs: { error: new Error('Forbidden') } });
    const load = await importLoad();
    const result = (await load(ev({}))) as { configs: unknown[]; configsError: boolean };
    expect(result.configs).toEqual([]);
    expect(result.configsError).toBe(true);
  });
});
