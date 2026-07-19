/**
 * Tests for the Integrations-tab loader (#336). AI service configs moved here
 * from the standalone /ai-configs route; the admin-gated failure path that used
 * to be covered on the org-detail loader lives here now.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AI_SERVICE_CONFIGS_QUERY,
  LINK_GITHUB_APP_MUTATION,
  UPDATE_ORG_GITHUB_APP_MUTATION,
} from '$lib/server/queries';

// `$env/dynamic/*` are SvelteKit virtual modules; vitest skips the SvelteKit
// plugin. The integrations +page.server.ts imports both for the
// `connectExchange` action — these load() tests don't exercise it.
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$env/dynamic/public', () => ({ env: {} }));

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
const fakeConfiguredOrg = {
  ...fakeOrg,
  githubAppId: '123456',
  githubInstallationId: 987654,
};
const fakeAiConfigs = [
  { id: 'cfg-1', name: 'bedrock-mm', ownerType: 'ORGANIZATION', ownerId: 'org-id-123', provider: 'bedrock', model: 'us.anthropic.claude-sonnet-4-6', hasApiKey: true, apiKeyPreview: '…', params: {}, enabled: true, createdAt: '2026-06-15', updatedAt: '2026-06-15' },
];

// The org comes from parent() (loaded by +layout.server.ts), so only
// AI_SERVICE_CONFIGS_QUERY reaches the client here.
function ev(opts: { orgId?: string; userId?: string; org?: typeof fakeOrg } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: 'test-token', user: { id: opts.userId ?? 'user-1' } },
    parent: async () => ({ org: opts.org ?? fakeOrg }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

async function runAction(
  name: 'linkGithub' | 'updateGithubApp',
  fields: Record<string, string>,
  opts: { orgId?: string } = {},
) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  const event = {
    request: { formData: async () => fd },
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: 'test-token' },
  } as unknown as Parameters<(typeof actions)[typeof name]>[0];
  return actions[name](event);
}

function routeMock(opts: { aiConfigs?: { data?: unknown; error?: unknown } }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === AI_SERVICE_CONFIGS_QUERY) {
      if (opts.aiConfigs?.error !== undefined) throw opts.aiConfigs.error;
      // hadron-server#473: wrap in the uniform { items, total } envelope.
      const configs =
        (opts.aiConfigs?.data as { aiServiceConfigs: unknown[] } | undefined)?.aiServiceConfigs ?? [];
      return { aiServiceConfigs: { items: configs, total: configs.length } };
    }
    throw new Error('Unexpected query passed to mockRequest');
  });
}

describe('Integrations load()', () => {
  it('happy path → returns org data, configs, and seeded GitHub Superforms', async () => {
    routeMock({ aiConfigs: { data: { aiServiceConfigs: fakeAiConfigs } } });
    const load = await importLoad();
    const result = (await load(ev({ org: fakeConfiguredOrg }))) as {
      org: typeof fakeConfiguredOrg;
      configs: typeof fakeAiConfigs;
      configsError: boolean;
      currentUserId: string;
      githubAppForm: { data: { _kind: string; appId: string; privateKey: string } };
      githubInstallationForm: { data: { _kind: string; installationId: string } };
    };
    expect(result).toMatchObject({
      org: fakeConfiguredOrg,
      configs: fakeAiConfigs,
      configsError: false,
      currentUserId: 'user-1',
    });
    expect(result.githubAppForm.data).toMatchObject({
      _kind: 'updateGithubApp',
      appId: '123456',
      privateKey: '',
    });
    expect(result.githubInstallationForm.data).toMatchObject({
      _kind: 'linkGithub',
      installationId: '987654',
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

describe('linkGithub action', () => {
  it('links an installation id and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('linkGithub', {
      installationId: '987654',
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'linkGithub', installationId: '987654' },
        message: { type: 'success', text: 'GitHub App installation linked.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      LINK_GITHUB_APP_MUTATION,
      { orgId: 'org-id-123', installationId: 987654 },
    ]);
  });

  it('rejects omitted installation ids before linking', async () => {
    const result = (await runAction('linkGithub', {})) as {
      status: number;
      data: { form: { data: { installationId: string }; errors: { installationId?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.data.installationId).toBe('');
    expect(result.data.form.errors.installationId?.[0]).toBe('Installation ID is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects non-numeric installation ids before linking', async () => {
    const result = (await runAction('linkGithub', {
      installationId: 'abc',
    })) as { status: number; data: { form: { errors: { installationId?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.installationId?.[0]).toBe('Installation ID must be a number');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects zero installation ids before linking', async () => {
    const result = (await runAction('linkGithub', {
      installationId: '0',
    })) as { status: number; data: { form: { errors: { installationId?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.installationId?.[0]).toBe('Installation ID must be a number');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when linking fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('not allowed'));
    const result = (await runAction('linkGithub', {
      installationId: '987654',
    })) as { status: number; data: { form: { message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'not allowed' });
  });
});

describe('updateGithubApp action', () => {
  it('saves custom GitHub App credentials, scrubs the key, and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('updateGithubApp', {
      appId: '123456',
      privateKey: '-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----',
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'updateGithubApp', appId: '123456', privateKey: '' },
        message: { type: 'success', text: 'GitHub App credentials saved.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      UPDATE_ORG_GITHUB_APP_MUTATION,
      {
        orgId: 'org-id-123',
        appId: '123456',
        privateKey: '-----BEGIN RSA PRIVATE KEY-----\nsecret\n-----END RSA PRIVATE KEY-----',
      },
    ]);
  });

  it('rejects missing credential fields and does not echo a submitted private key', async () => {
    const result = (await runAction('updateGithubApp', {
      privateKey: 'secret',
    })) as {
      status: number;
      data: { form: { data: { appId: string; privateKey: string }; errors: { appId?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.data.appId).toBe('');
    expect(result.data.form.data.privateKey).toBe('');
    expect(result.data.form.errors.appId?.[0]).toBe('App ID is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('scrubs the private key when saving credentials fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('bad key'));
    const result = (await runAction('updateGithubApp', {
      appId: '123456',
      privateKey: 'secret',
    })) as {
      status: number;
      data: { form: { data: { privateKey: string }; message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.data.privateKey).toBe('');
    expect(result.data.form.message).toEqual({ type: 'error', text: 'bad key' });
  });
});
