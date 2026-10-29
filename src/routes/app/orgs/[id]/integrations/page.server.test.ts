/**
 * Tests for the Integrations-tab loader (#336). AI service configs moved here
 * from the standalone /ai-configs route; the admin-gated failure path that used
 * to be covered on the org-detail loader lives here now.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import {
  ORG_INTEGRATIONS_TAB_QUERY,
  AI_SERVICE_CONFIGS_QUERY,
  DELETE_EXCHANGE_CONNECTION_MUTATION,
  LINK_GITHUB_APP_MUTATION,
  TEST_EXCHANGE_CONNECTION_MUTATION,
  UPDATE_ORG_GITHUB_APP_MUTATION,
  UNLINK_GITHUB_APP_MUTATION,
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

afterEach(() => {
  vi.unstubAllGlobals();
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
  name:
    | 'linkGithub'
    | 'updateGithubApp'
    | 'unlinkGithub'
    | 'connectExchange'
    | 'deleteExchangeConnection'
    | 'testExchangeConnection',
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

function superFormFrom(result: unknown) {
  return (result as {
    data?: {
      form?: {
        data?: Record<string, unknown>;
        errors?: Record<string, string[]>;
        message?: App.Superforms.Message;
        valid?: boolean;
      };
    };
    form?: {
      data?: Record<string, unknown>;
      errors?: Record<string, string[]>;
      message?: App.Superforms.Message;
      valid?: boolean;
    };
  } | undefined)?.data?.form ?? (result as {
    form?: {
      data?: Record<string, unknown>;
      errors?: Record<string, string[]>;
      message?: App.Superforms.Message;
      valid?: boolean;
    };
  } | undefined)?.form;
}

function routeMock(opts: { aiConfigs?: { data?: unknown; error?: unknown }; org?: unknown }) {
  mockRequest.mockImplementation(async (query: string) => {
    // #845: this tab reads `exchangeConnections`, `members` and the GitHub App
    // fields, none of which the layout carries any more — so it fetches the org
    // itself and THIS is where a test supplies one. `ev({ org })` feeds
    // parent(), which now only carries chrome.
    if (query === ORG_INTEGRATIONS_TAB_QUERY) return { organization: opts.org ?? fakeOrg };
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

describe('Integrations form ids (#1320)', () => {
  it('gives every form the loader returns its own Superforms id', async () => {
    routeMock({ aiConfigs: { data: { aiServiceConfigs: fakeAiConfigs } }, org: fakeConfiguredOrg });
    const load = await importLoad();
    expectDistinctFormIds(await load(ev()), 6);
  });
});

describe('Integrations load()', () => {
  it('happy path → returns org data, configs, and seeded GitHub Superforms', async () => {
    // #845: the org is supplied through the QUERY mock now, not parent().
    routeMock({ aiConfigs: { data: { aiServiceConfigs: fakeAiConfigs } }, org: fakeConfiguredOrg });
    const load = await importLoad();
    const result = (await load(ev())) as {
      org: typeof fakeConfiguredOrg;
      configs: typeof fakeAiConfigs;
      configsError: boolean;
      currentUserId: string;
      githubAppForm: { data: { _kind: string; appId: string; privateKey: string } };
      githubInstallationForm: { data: { _kind: string; installationId: string } };
      unlinkGithubForm: { data: { _kind: string } };
      connectExchangeForm: { data: { _kind: string } };
      testExchangeConnectionForm: { data: { _kind: string; connectionId: string } };
      deleteExchangeConnectionForm: { data: { _kind: string; connectionId: string } };
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
    expect(result.unlinkGithubForm.data).toMatchObject({ _kind: 'unlinkGithub' });
    expect(result.connectExchangeForm.data).toMatchObject({ _kind: 'connectExchange' });
    expect(result.testExchangeConnectionForm.data).toMatchObject({
      _kind: 'testExchangeConnection',
      connectionId: '',
    });
    expect(result.deleteExchangeConnectionForm.data).toMatchObject({
      _kind: 'deleteExchangeConnection',
      connectionId: '',
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

  it('rejects installation ids larger than GraphQL Int before linking', async () => {
    const result = (await runAction('linkGithub', {
      installationId: '2147483648',
    })) as { status: number; data: { form: { errors: { installationId?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.installationId?.[0]).toBe('Installation ID is too large');
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

  it('rejects updateGithubApp POSTs with the wrong form discriminator and scrubs the key', async () => {
    const result = (await runAction('updateGithubApp', {
      _kind: 'linkGithub',
      appId: '123456',
      privateKey: 'secret',
    })) as {
      status: number;
      data: { form: { data: { privateKey: string }; errors: { _kind?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.data.privateKey).toBe('');
    expect(result.data.form.errors._kind).toBeDefined();
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

  it('redacts the private key if a credential save error echoes it', async () => {
    mockRequest.mockRejectedValueOnce(
      new Error('Invalid PEM: secret was rejected'),
    );
    const result = (await runAction('updateGithubApp', {
      appId: '123456',
      privateKey: 'secret',
    })) as {
      status: number;
      data: { form: { data: { privateKey: string }; message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.data.privateKey).toBe('');
    expect(result.data.form.message).toEqual({
      type: 'error',
      text: 'Invalid PEM: [redacted] was rejected',
    });
  });
});

describe('unlinkGithub action', () => {
  it('unlinks GitHub and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});

    const result = await runAction('unlinkGithub', {});

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'unlinkGithub' },
        message: { type: 'success', text: 'GitHub App disconnected.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      UNLINK_GITHUB_APP_MUTATION,
      { orgId: 'org-id-123' },
    ]);
  });

  it('rejects unlinkGithub POSTs with the wrong form discriminator', async () => {
    const result = await runAction('unlinkGithub', { _kind: 'connectExchange' });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('connectExchange action', () => {
  it('starts Microsoft OAuth through the local server and throws the browser redirect', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ nonce: 'nonce/with space' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    let thrown: unknown;
    try {
      await runAction('connectExchange', {}, { orgId: 'org/with space' });
    } catch (e) {
      thrown = e;
    }

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:4000/auth/microsoft/start', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer test-token',
      },
      body: JSON.stringify({
        orgId: 'org/with space',
        redirect: '/app/orgs/org%2Fwith%20space/integrations',
      }),
    });
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe(
      'http://localhost:4000/auth/microsoft?nonce=nonce%2Fwith%20space',
    );
  });

  it('returns a typed error with the upstream status when the OAuth start endpoint rejects the request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));

    const result = await runAction('connectExchange', {});

    expect((result as { status: number }).status).toBe(403);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Failed to start Microsoft sign-in.',
    });
  });

  it('returns a typed unreachable error when the OAuth start request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNRESET')));

    const result = await runAction('connectExchange', {});

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Could not reach the server to start sign-in.',
    });
  });

  it('rejects connectExchange POSTs with the wrong form discriminator', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await runAction('connectExchange', { _kind: 'unlinkGithub' });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('deleteExchangeConnection action', () => {
  it('deletes an Exchange connection and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});

    const result = await runAction('deleteExchangeConnection', {
      connectionId: 'exchange-1',
    });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'deleteExchangeConnection', connectionId: 'exchange-1' },
        message: { type: 'success', text: 'Exchange connection removed.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      DELETE_EXCHANGE_CONNECTION_MUTATION,
      { id: 'exchange-1' },
    ]);
  });

  it('rejects missing Exchange connection ids before deleting', async () => {
    const result = await runAction('deleteExchangeConnection', {});

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?.connectionId?.[0]).toBe('Connection ID is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects deleteExchangeConnection POSTs with the wrong form discriminator', async () => {
    const result = await runAction('deleteExchangeConnection', {
      _kind: 'testExchangeConnection',
      connectionId: 'exchange-1',
    });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when deleting fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('still syncing'));

    const result = await runAction('deleteExchangeConnection', {
      connectionId: 'exchange-1',
    });

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'still syncing',
    });
  });
});

describe('testExchangeConnection action', () => {
  it('tests an Exchange connection and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});

    const result = await runAction('testExchangeConnection', {
      connectionId: 'exchange-1',
    });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'testExchangeConnection', connectionId: 'exchange-1' },
        message: { type: 'success', text: 'Exchange connection test passed.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      TEST_EXCHANGE_CONNECTION_MUTATION,
      { id: 'exchange-1' },
    ]);
  });

  it('rejects missing Exchange connection ids before testing', async () => {
    const result = await runAction('testExchangeConnection', {});

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?.connectionId?.[0]).toBe('Connection ID is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects testExchangeConnection POSTs with the wrong form discriminator', async () => {
    const result = await runAction('testExchangeConnection', {
      _kind: 'deleteExchangeConnection',
      connectionId: 'exchange-1',
    });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when the connection test fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('tenant unavailable'));

    const result = await runAction('testExchangeConnection', {
      connectionId: 'exchange-1',
    });

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'tenant unavailable',
    });
  });
});
