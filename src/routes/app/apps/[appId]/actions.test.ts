import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADD_AGENT_TO_APP_MUTATION,
  APP_NODES_QUERY,
  APP_QUERY,
  CREATE_APP_KEY_MUTATION,
  DELETE_APP_MUTATION,
  ORGANIZATION_QUERY,
  REMOVE_AGENT_FROM_APP_MUTATION,
  REVOKE_APP_KEY_MUTATION,
  UPDATE_APP_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
const mockFetchAllItems = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: mockFetchAllItems,
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockFetchAllItems.mockReset();
});

async function runAction(
  name: 'update' | 'addAgent' | 'removeAgent' | 'updateAgentTools' | 'createKey' | 'revokeKey' | 'deleteApp',
  fields: Record<string, string | string[]>,
) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) fd.append(key, item);
    } else {
      fd.set(key, value);
    }
  }
  const event = {
    request: { formData: async () => fd },
    params: { id: 'org-1', appId: 'app-1' },
    locals: { token: 'tok' },
  } as unknown as Parameters<(typeof actions)[typeof name]>[0];
  return actions[name](event);
}

const validSettings = {
  name: 'Demo App',
  urn: 'demo-app',
  appType: 'CHATBOT',
  role: 'ADMIN',
  description: 'A demo',
  systemPrompt: 'Be useful',
  createUserPermission: 'IMPLICIT',
  identifyUserMethod: 'SECRET',
  sessionTimeoutSeconds: '3600',
  anonymousTtlDays: '14',
};

describe('load', () => {
  it('seeds the link-agent form with an explicit empty choice', async () => {
    mockFetchAllItems.mockResolvedValueOnce([]);
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) {
        return Promise.resolve({
          app: {
            id: 'app-1',
            name: 'Demo App',
            urn: 'hadronmemory.com:demo-org:demo-app',
            // #648: org-owned app → the loader fetches the org (ORGANIZATION_QUERY
            // below) and availableAgents = org.agents.
            organizationId: 'org-1',
            appType: 'CHATBOT',
            role: 'ADMIN',
            description: null,
            systemPrompt: null,
            createUserPermission: 'DENY',
            identifyUserMethod: 'USER_ID',
            sessionTimeoutSeconds: 3600,
            anonymousTtlDays: 14,
            agentId: null,
            agent: null,
          },
        });
      }
      if (query === ORGANIZATION_QUERY) {
        return Promise.resolve({
          organization: {
            id: 'org-1',
            urn: 'hadronmemory.com:demo-org',
            name: 'Demo Org',
            agents: [{ id: 'agent-1', name: 'Agent One', urn: 'agent:one' }],
          },
        });
      }
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      throw new Error('Unexpected query');
    });

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0])) as { addAgentForm: { data: { agentId: string } } };

    expect(result.addAgentForm.data.agentId).toBe('');
  });
});

describe('update action', () => {
  it('updates app settings from a validated Superform and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('update', validSettings);
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'updateApp', name: 'Demo App', urn: 'demo-app' },
        message: { type: 'success', text: 'Saved.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      UPDATE_APP_MUTATION,
      {
        id: 'app-1',
        name: 'Demo App',
        urn: 'demo-app',
        appType: 'CHATBOT',
        role: 'ADMIN',
        description: 'A demo',
        systemPrompt: 'Be useful',
        createUserPermission: 'IMPLICIT',
        identifyUserMethod: 'SECRET',
        sessionTimeoutSeconds: 3600,
        anonymousTtlDays: 14,
      },
    ]);
  });

  it('normalizes blank optional text fields to null', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('update', {
      ...validSettings,
      description: '',
      systemPrompt: '',
    });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      description: null,
      systemPrompt: null,
    });
  });

  it('rejects omitted required settings before mutation', async () => {
    const result = (await runAction('update', {
      ...validSettings,
      name: '',
    })) as { status: number; data: { form: { errors: { name?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.name?.[0]).toBe('Name is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects out-of-range numeric settings before mutation', async () => {
    const result = (await runAction('update', {
      ...validSettings,
      sessionTimeoutSeconds: '59',
      anonymousTtlDays: '91',
    })) as {
      status: number;
      data: { form: { errors: { sessionTimeoutSeconds?: string[]; anonymousTtlDays?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.sessionTimeoutSeconds?.[0]).toBe('Session timeout must be at least 60 seconds');
    expect(result.data.form.errors.anonymousTtlDays?.[0]).toBe('Anonymous TTL must be at most 90 days');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects update POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('update', {
      ...validSettings,
      _kind: 'addAgent',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when app update fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('update', validSettings)) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('addAgent action', () => {
  it('links an agent and preserves explicit training mode', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('addAgent', {
      agentId: 'agent-1',
      trainingMode: 'true',
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'addAgent', agentId: 'agent-1', trainingMode: 'true' },
        message: { type: 'success', text: 'Agent linked.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      ADD_AGENT_TO_APP_MUTATION,
      { appId: 'app-1', agentId: 'agent-1', trainingMode: true },
    ]);
  });

  it('omits training mode when the form did not submit it', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('addAgent', { agentId: 'agent-1' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ appId: 'app-1', agentId: 'agent-1' });
  });

  it('rejects missing agent ids before mutation', async () => {
    const result = (await runAction('addAgent', {})) as {
      status: number;
      data: { form: { errors: { agentId?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.agentId?.[0]).toBe('Agent is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects addAgent POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('addAgent', {
      _kind: 'createKey',
      agentId: 'agent-1',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid training mode values before mutation', async () => {
    const result = (await runAction('addAgent', {
      agentId: 'agent-1',
      trainingMode: 'sometimes',
    })) as { status: number; data: { form: { errors: { trainingMode?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.trainingMode).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('createKey action', () => {
  it('creates an app key from a trimmed optional label', async () => {
    mockRequest.mockResolvedValueOnce({
      createAppKey: { key: { id: 'key-1' }, rawKey: 'raw-key' },
    });
    const result = await runAction('createKey', { label: ' production ' });
    expect(result).toMatchObject({
      rawKey: 'raw-key',
      keyId: 'key-1',
      form: { valid: true, data: { _kind: 'createKey', label: 'production' } },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      CREATE_APP_KEY_MUTATION,
      { appId: 'app-1', label: 'production' },
    ]);
  });

  it('sends undefined for a blank key label', async () => {
    mockRequest.mockResolvedValueOnce({
      createAppKey: { key: { id: 'key-1' }, rawKey: 'raw-key' },
    });
    await runAction('createKey', { label: '' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ appId: 'app-1', label: undefined });
  });

  it('rejects createKey POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('createKey', {
      _kind: 'addAgent',
      label: 'production',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when key creation fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('createKey', { label: 'production' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('removeAgent action', () => {
  it('unlinks an agent with trimmed Superforms data', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('removeAgent', { agentId: ' agent-1 ' });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'removeAgent', agentId: 'agent-1' },
        message: { type: 'success', text: 'Agent unlinked.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      REMOVE_AGENT_FROM_APP_MUTATION,
      { appId: 'app-1', agentId: 'agent-1' },
    ]);
  });

  it('rejects removeAgent POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('removeAgent', {
      _kind: 'addAgent',
      agentId: 'agent-1',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects removeAgent POSTs with an omitted agent before mutation', async () => {
    const result = (await runAction('removeAgent', {})) as {
      status: number;
      data: { form: { errors: { agentId?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.agentId?.[0]).toBe('Agent is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns typed removeAgent errors', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('removeAgent', { agentId: 'agent-1' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('updateAgentTools action', () => {
  it('saves repeated agent tool inputs as an array', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('updateAgentTools', {
      agentTools: ['CLAUDE_CODE', 'MCP_INSPECTOR'],
    });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'updateAgentTools', agentTools: ['CLAUDE_CODE', 'MCP_INSPECTOR'] },
        message: { type: 'success', text: 'Client tools saved.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      UPDATE_APP_MUTATION,
      { id: 'app-1', agentTools: ['CLAUDE_CODE', 'MCP_INSPECTOR'] },
    ]);
  });

  it('saves an empty agent tools list when no tools are selected', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('updateAgentTools', {});

    expect(mockRequest.mock.calls[0]).toEqual([
      UPDATE_APP_MUTATION,
      { id: 'app-1', agentTools: [] },
    ]);
  });

  it('rejects updateAgentTools POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('updateAgentTools', {
      _kind: 'deleteApp',
      agentTools: 'CLAUDE_CODE',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns typed updateAgentTools errors', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('updateAgentTools', { agentTools: 'CLAUDE_CODE' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('revokeKey action', () => {
  it('revokes an app key with trimmed Superforms data', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('revokeKey', { keyId: ' key-1 ' });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'revokeKey', keyId: 'key-1' },
        message: { type: 'success', text: 'Key revoked.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      REVOKE_APP_KEY_MUTATION,
      { id: 'key-1' },
    ]);
  });

  it('rejects revokeKey POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('revokeKey', {
      _kind: 'createKey',
      keyId: 'key-1',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects revokeKey POSTs with an omitted key before mutation', async () => {
    const result = (await runAction('revokeKey', {})) as {
      status: number;
      data: { form: { errors: { keyId?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.keyId?.[0]).toBe('Key is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns typed revokeKey errors', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('revokeKey', { keyId: 'key-1' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('deleteApp action', () => {
  // #648: the action resolves the app's org (first request) before deleting
  // (second), then redirects to the org grid or the personal My apps list.
  it('deletes an org app and redirects to the org apps grid', async () => {
    mockRequest
      .mockResolvedValueOnce({ app: { organizationId: 'org-1' } }) // org lookup
      .mockResolvedValueOnce({}); // delete
    await expect(runAction('deleteApp', {})).rejects.toMatchObject({
      status: 303,
      location: '/app/orgs/org-1/apps',
    });
    expect(mockRequest.mock.calls[1]).toEqual([
      DELETE_APP_MUTATION,
      { id: 'app-1' },
    ]);
  });

  it('deletes a user-owned (org-less) app and redirects to the personal My apps list', async () => {
    mockRequest
      .mockResolvedValueOnce({ app: { organizationId: null } }) // org lookup
      .mockResolvedValueOnce({}); // delete
    await expect(runAction('deleteApp', {})).rejects.toMatchObject({
      status: 303,
      location: '/app/apps',
    });
  });

  it('rejects deleteApp POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('deleteApp', {
      _kind: 'revokeKey',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns typed deleteApp errors', async () => {
    mockRequest
      .mockResolvedValueOnce({ app: { organizationId: 'org-1' } }) // org lookup ok
      .mockRejectedValueOnce(new Error('nope')); // delete fails
    const result = (await runAction('deleteApp', {})) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});
