import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADD_AGENT_TO_APP_MUTATION,
  APP_NODES_QUERY,
  APP_QUERY,
  CAST_WORKER_MUTATION,
  CREATE_APP_KEY_MUTATION,
  DELETE_APP_MUTATION,
  ORGANIZATION_QUERY,
  REMOVE_AGENT_FROM_APP_MUTATION,
  RETIRE_WORKER_MUTATION,
  REVOKE_APP_KEY_MUTATION,
  TEAM_CHAT_MESSAGES_QUERY,
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

/** A minimal App row for loader tests that don't care about its fields. */
function baseApp(over: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    name: 'Demo App',
    urn: 'hadronmemory.com:demo-org:demo-app',
    organizationId: null,
    appType: 'CHATBOT',
    role: 'ADMIN',
    description: null,
    systemPrompt: null,
    createUserPermission: 'DENY',
    identifyUserMethod: 'USER_ID',
    sessionTimeoutSeconds: 3600,
    anonymousTtlDays: 14,
    agentId: 'agent-1',
    agent: null,
    ...over,
  };
}

beforeEach(() => {
  mockRequest.mockReset();
  mockFetchAllItems.mockReset();
});

async function runAction(
  name:
    | 'update' | 'addAgent' | 'removeAgent' | 'updateAgentTools' | 'createKey'
    | 'revokeKey' | 'deleteApp' | 'castWorker' | 'retireWorker'
    | 'postTeamChatMessage',
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
    // mockResolvedValue (not …Once): the loader makes SEVERAL paginated calls —
    // AI configs and, since #974, the App's Worker staff.
    mockFetchAllItems.mockResolvedValue([]);
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
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
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

  // #974: "couldn't load the staff" and "this App has no staff" are different
  // statements, and the empty state must not tell the second lie. The loader
  // therefore coerces a failed workers fetch to null, never [].
  it('reports a failed staff fetch as null, distinct from an empty staff list', async () => {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) {
        return Promise.resolve({
          app: {
            id: 'app-1', name: 'Demo App', urn: 'hadronmemory.com:demo-org:demo-app',
            organizationId: null, appType: 'CHATBOT', role: 'ADMIN',
            description: null, systemPrompt: null,
            createUserPermission: 'DENY', identifyUserMethod: 'USER_ID',
            sessionTimeoutSeconds: 3600, anonymousTtlDays: 14,
            agentId: 'agent-1', agent: null,
          },
        });
      }
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    // AI configs resolve; the workers page rejects.
    mockFetchAllItems
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('workers exploded'));

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0])) as { staff: unknown; staffError: boolean };

    expect(result.staff).toBeNull();
    expect(result.staffError).toBe(true);
  });

  it('returns an empty staff list as [] with no error flag', async () => {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) {
        return Promise.resolve({
          app: {
            id: 'app-1', name: 'Demo App', urn: 'hadronmemory.com:demo-org:demo-app',
            organizationId: null, appType: 'CHATBOT', role: 'ADMIN',
            description: null, systemPrompt: null,
            createUserPermission: 'DENY', identifyUserMethod: 'USER_ID',
            sessionTimeoutSeconds: 3600, anonymousTtlDays: 14,
            agentId: 'agent-1', agent: null,
          },
        });
      }
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0])) as { staff: unknown[]; staffError: boolean };

    expect(result.staff).toEqual([]);
    expect(result.staffError).toBe(false);
  });

  // #732: same discipline as the staff fetch above. A failed transcript fetch
  // must not render as "no messages in the team chat yet" — that empty state is
  // a claim about the team, and making it on a network failure is a lie the
  // reader cannot detect.
  it('reports a failed team chat fetch as an error flag, not as an empty chat', async () => {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) return Promise.reject(new Error('chat exploded'));
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0])) as {
      teamChatMessages: unknown[];
      teamChatError: boolean;
    };

    expect(result.teamChatError).toBe(true);
    expect(result.teamChatMessages).toEqual([]);
  });

  // The negative case for the above: an empty chat is NOT an error. Without
  // this, an implementation that flagged every empty transcript as failed would
  // pass the test above (review:guard-must-be-proven-to-fail).
  it('reports a genuinely empty team chat with no error flag', async () => {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0])) as {
      teamChatMessages: unknown[];
      teamChatTotal: number;
      teamChatError: boolean;
    };

    expect(result.teamChatError).toBe(false);
    expect(result.teamChatMessages).toEqual([]);
    expect(result.teamChatTotal).toBe(0);
  });

  // The server's total is what tells the tab its view is a suffix of the real
  // thread. Passing back `items.length` instead would make every truncated
  // transcript look complete.
  it('carries the server total through, not the fetched count', async () => {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({
          teamChatMessages: { items: [{ nodeId: 'n1', seq: 42 }], total: 913 },
        });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0])) as {
      teamChatMessages: unknown[];
      teamChatTotal: number;
    };

    expect(result.teamChatMessages).toHaveLength(1);
    expect(result.teamChatTotal).toBe(913);
  });

  it('reads the team chat by appRef, never by walking appNodes', async () => {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);

    const { load } = await import('./+page.server');
    await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0]);

    const call = mockRequest.mock.calls.find((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY);
    expect(call?.[1]).toMatchObject({ appRef: 'app-1' });
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
        ref: 'app-1',
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
      { appRef: 'app-1', agentRef: 'agent-1', trainingMode: true },
    ]);
  });

  it('omits training mode when the form did not submit it', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('addAgent', { agentId: 'agent-1' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ appRef: 'app-1', agentRef: 'agent-1' });
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
      { appRef: 'app-1', label: 'production' },
    ]);
  });

  it('sends undefined for a blank key label', async () => {
    mockRequest.mockResolvedValueOnce({
      createAppKey: { key: { id: 'key-1' }, rawKey: 'raw-key' },
    });
    await runAction('createKey', { label: '' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ appRef: 'app-1', label: undefined });
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
      { appRef: 'app-1', agentRef: 'agent-1' },
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
      { ref: 'app-1', agentTools: ['CLAUDE_CODE', 'MCP_INSPECTOR'] },
    ]);
  });

  it('saves an empty agent tools list when no tools are selected', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('updateAgentTools', {});

    expect(mockRequest.mock.calls[0]).toEqual([
      UPDATE_APP_MUTATION,
      { ref: 'app-1', agentTools: [] },
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
      { ref: 'app-1' },
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

// ── Casting (#974, cor:dmo:050:11) ──────────────────────────────────────────
//
// castWorker CASTS an agent that is already installed; it mints nothing. The
// interesting behaviour is at the edges: `name` and `role` are OPTIONAL, and
// omitting them means something specific server-side (walk the cast-list
// register / inherit the agent's persona role). Sending '' instead would be an
// explicit-and-invalid name, so the blank→undefined coercion is the contract
// this action has to hold up.

describe('castWorker action', () => {
  it('casts an installed agent under an explicit name and role', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('castWorker', {
      agentId: 'agent-1',
      name: 'Iris',
      role: 'backend-engineer',
    });
    expect(result).toMatchObject({
      form: { valid: true, message: { type: 'success', text: 'Worker cast.' } },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      CAST_WORKER_MUTATION,
      {
        appRef: 'app-1',
        agentRef: 'agent-1',
        name: 'Iris',
        role: 'backend-engineer',
        promptOverride: undefined,
      },
    ]);
  });

  it('sends a blank name and role as UNDEFINED, not ""', async () => {
    // The whole point: undefined = "server, you choose" (walk the register /
    // inherit personaRole). '' would be an explicit empty name — a different,
    // invalid request.
    mockRequest.mockResolvedValueOnce({});
    await runAction('castWorker', { agentId: 'agent-1', name: '', role: '' });
    const vars = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(vars.name).toBeUndefined();
    expect(vars.role).toBeUndefined();
    expect(vars.agentRef).toBe('agent-1');
  });

  it('rejects a missing agent before the mutation', async () => {
    const result = (await runAction('castWorker', { name: 'Iris' })) as {
      status: number;
      data: { form: { errors: { agentId?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.agentId?.[0]).toBe('Select an agent to cast.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects castWorker POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('castWorker', {
      agentId: 'agent-1',
      _kind: 'addAgent',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('translates WORKER_NAME_TAKEN into copy that says what to do', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'taken', extensions: { code: 'WORKER_NAME_TAKEN' } }] },
    });
    const result = (await runAction('castWorker', { agentId: 'agent-1', name: 'Iris' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message.type).toBe('error');
    expect(result.data.form.message.text).toContain('already taken');
    // The permanence of the reservation is the non-obvious part — a user who
    // isn't told it will just try the retired worker's name again.
    expect(result.data.form.message.text).toContain('reserved permanently');
  });

  it('translates WORKER_AGENT_NOT_INSTALLED', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ extensions: { code: 'WORKER_AGENT_NOT_INSTALLED' } }] },
    });
    const result = (await runAction('castWorker', { agentId: 'agent-9' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toContain('not installed');
  });

  // Codex on PR #716: a reader can reach these controls, because the portal
  // deliberately doesn't re-derive the server's three-branch staffing gate to
  // pre-hide them. The refusal therefore has to be a sentence, not a raw
  // server string.
  it('translates FORBIDDEN into copy naming the access actually needed', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
    });
    const result = (await runAction('castWorker', { agentId: 'agent-1' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toContain('permission to staff this App');
    expect(result.data.form.message.text).toContain('contributor access');
  });

  it('falls back to the server message for an UNKNOWN code', async () => {
    // review:clienterror-map-known-codes-only — only known codes get friendly
    // copy; an internal error must not be relabelled as a user mistake.
    mockRequest.mockRejectedValueOnce({
      message: 'boom',
      response: { errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] },
    });
    const result = (await runAction('castWorker', { agentId: 'agent-1' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toBe('boom');
  });

  it('falls back to the server message for a payload-less transport failure', async () => {
    // No `response.errors` at all — reading extensions.code off it would yield
    // undefined and, with a catch-all, mislabel an outage.
    mockRequest.mockRejectedValueOnce(new Error('bad gateway'));
    const result = (await runAction('castWorker', { agentId: 'agent-1' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toBe('bad gateway');
  });
});

describe('retireWorker action', () => {
  it('retires a worker and says the name stays reserved', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('retireWorker', { workerId: 'worker-1' });
    expect(mockRequest.mock.calls[0]).toEqual([
      RETIRE_WORKER_MUTATION,
      { workerRef: 'worker-1' },
    ]);
    expect((result as { form: { message: { text: string } } }).form.message.text)
      .toContain('name stays reserved');
  });

  it('rejects a missing worker id before the mutation', async () => {
    const result = (await runAction('retireWorker', {})) as {
      status: number;
      data: { form: { errors: { workerId?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when retiring fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('retireWorker', { workerId: 'worker-1' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });

  // Retiring shares castWorker's gate, so it must share its refusal copy —
  // otherwise the same lack of access reads as two different failures.
  it('translates FORBIDDEN the same way casting does', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
    });
    const result = (await runAction('retireWorker', { workerId: 'worker-1' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toContain('permission to staff this App');
  });
});

describe('postTeamChatMessage action (#732)', () => {
  function gqlError(code: string) {
    return { response: { errors: [{ extensions: { code }, message: 'raw server message' }] } };
  }

  it('posts to the App by appRef and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({ createTeamChatMessage: { nodeId: 'n1', seq: 36 } });
    const result = await runAction('postTeamChatMessage', {
      _kind: 'postTeamChatMessage',
      body: 'Gil on shift.',
    });
    expect(result).toMatchObject({
      form: { valid: true, message: { type: 'success' } },
    });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      appRef: 'app-1',
      body: 'Gil on shift.',
    });
  });

  // The portal has no worker session, so a post from here is the signed-in
  // human's. Sending a sessionRef would be forged attribution on the record the
  // team uses to answer "who did this".
  it('never sends a sessionRef', async () => {
    mockRequest.mockResolvedValueOnce({ createTeamChatMessage: { nodeId: 'n1', seq: 1 } });
    await runAction('postTeamChatMessage', { _kind: 'postTeamChatMessage', body: 'hi' });
    expect(mockRequest.mock.calls[0][1]).not.toHaveProperty('sessionRef');
  });

  it('forwards a reply target as a number', async () => {
    mockRequest.mockResolvedValueOnce({ createTeamChatMessage: { nodeId: 'n1', seq: 37 } });
    await runAction('postTeamChatMessage', {
      _kind: 'postTeamChatMessage',
      body: 'answering',
      replyToSeq: '14',
    });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ replyToSeq: 14 });
  });

  // seq ascends from 1, so 0 / NaN / negatives could only ever be a client bug.
  // Forwarding one would turn a stray hidden input into TEAM_CHAT_REPLY_NOT_FOUND
  // on what the user experienced as an ordinary post.
  it.each([['', undefined], ['0', undefined], ['abc', undefined], ['-3', undefined], ['2.5', undefined]])(
    'drops an unusable replyToSeq %j rather than sending it',
    async (input) => {
      mockRequest.mockResolvedValueOnce({ createTeamChatMessage: { nodeId: 'n1', seq: 2 } });
      await runAction('postTeamChatMessage', {
        _kind: 'postTeamChatMessage',
        body: 'plain post',
        replyToSeq: input as string,
      });
      expect(mockRequest.mock.calls[0][1].replyToSeq).toBeUndefined();
    },
  );

  it('rejects an empty body before calling GraphQL', async () => {
    const result = (await runAction('postTeamChatMessage', {
      _kind: 'postTeamChatMessage',
      body: '   ',
    })) as { data: { form: { valid: boolean } } };
    expect(result.data.form.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps a known refusal to actionable copy instead of the raw server message', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('FORBIDDEN'));
    const result = (await runAction('postTeamChatMessage', {
      _kind: 'postTeamChatMessage',
      body: 'hi',
    })) as { data: { form: { message: { text: string } } } };
    expect(result.data.form.message.text).toContain('App membership');
    expect(result.data.form.message.text).not.toContain('raw server message');
  });

  // review:clienterror-map-known-codes-only — an unknown code (or a transport
  // failure with no GraphQL payload) must fall through to the server's own
  // message rather than being relabelled as a user mistake.
  it('falls through to the server message for an unmapped code', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('SOME_NEW_CODE'));
    const result = (await runAction('postTeamChatMessage', {
      _kind: 'postTeamChatMessage',
      body: 'hi',
    })) as { data: { form: { message: { text: string } } } };
    expect(result.data.form.message.text).toContain('raw server message');
  });
});

// Codex P1 on PR #738. `teamChatMessages` is seq-ordered ASCENDING with an
// offset cursor, so a bare `limit` returns the OLDEST page. Past the cap that
// pins the transcript to the start of history and silently swallows every new
// post — including the one the user just made, since the composer invalidates
// and re-reads — while the tab captions it "the most recent messages".
describe('team chat tail paging (#738)', () => {
  function stubChat(pages: Array<{ items: unknown[]; total: number }>) {
    let call = 0;
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        const page = pages[Math.min(call, pages.length - 1)];
        call += 1;
        return Promise.resolve({ teamChatMessages: page });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);
  }

  async function runLoad() {
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
  }

  it('makes a second request for the tail when the chat exceeds the page cap', async () => {
    const oldest = Array.from({ length: 200 }, (_, i) => ({ nodeId: `n${i + 1}`, seq: i + 1 }));
    const newest = Array.from({ length: 200 }, (_, i) => ({ nodeId: `n${i + 301}`, seq: i + 301 }));
    stubChat([
      { items: oldest, total: 500 },
      { items: newest, total: 500 },
    ]);

    const result = await runLoad();
    const chatCalls = mockRequest.mock.calls.filter((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY);
    expect(chatCalls).toHaveLength(2);
    // total 500, cap 200 → the last 200 start at offset 300.
    expect(chatCalls[1][1]).toMatchObject({ offset: 300, limit: 200 });
    // And the rendered page is the NEWEST one, not the first response.
    expect((result.teamChatMessages as Array<{ seq: number }>)[0].seq).toBe(301);
  });

  // The negative case: an implementation that always double-fetched would pass
  // the test above. A chat inside the cap must cost exactly one request.
  it('makes only one request when the whole chat fits in one page', async () => {
    stubChat([{ items: [{ nodeId: 'n1', seq: 1 }], total: 1 }]);
    await runLoad();
    expect(mockRequest.mock.calls.filter((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY)).toHaveLength(1);
  });

  it('does not re-fetch when the chat is exactly the page size', async () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ nodeId: `n${i + 1}`, seq: i + 1 }));
    stubChat([{ items, total: 200 }]);
    await runLoad();
    expect(mockRequest.mock.calls.filter((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY)).toHaveLength(1);
  });

  // Messages can land between the two reads, so the tail response's count is
  // the one that describes the page actually being rendered.
  it('reports the total from the tail read, not the first', async () => {
    stubChat([
      { items: [{ nodeId: 'a', seq: 1 }], total: 500 },
      { items: [{ nodeId: 'b', seq: 501 }], total: 501 },
    ]);
    const result = await runLoad();
    expect(result.teamChatTotal).toBe(501);
  });
});
