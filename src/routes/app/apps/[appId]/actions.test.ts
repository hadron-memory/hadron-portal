import { castWorkerSchema } from './schema';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import { APP_KEY_IMPERSONATION_READ_ONLY, APP_KEY_MANAGERS_ONLY } from '$lib/server/app-key-refusal';
import { AGENT_TOOLS_IMPERSONATION_READ_ONLY, AGENT_TOOLS_MANAGERS_ONLY } from './agent-tools-refusal';
import {
  INSTALL_AGENT_INTO_APP_MUTATION,
  APP_NODES_QUERY,
  APP_QUERY,
  APP_CHAT_TARGET_QUERY,
  CHANNEL_CHAT_TARGET_QUERY,
  CREATE_CHANNEL_MESSAGE_MUTATION,
  APP_KEYS_QUERY,
  APP_MEMBERS_QUERY,
  CAST_WORKER_MUTATION,
  CREATE_APP_KEY_MUTATION,
  DELETE_APP_MUTATION,
  APP_DETAIL_ORG_QUERY,
  APP_ORG_AGENTS_QUERY,
  APP_ORG_AGENT_GRANTS_QUERY,
  UNINSTALL_AGENT_FROM_APP_MUTATION,
  RELEASE_WORKER_MUTATION,
  RETIRE_WORKER_MUTATION,
  REVOKE_APP_KEY_MUTATION,
  SELF_CAN_MANAGE_QUERY,
  TEAM_CHAT_MESSAGES_QUERY,
  TEAM_WORK_ITEMS_QUERY,
  APP_CHAT_ROOTS_QUERY,
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

    createUserPermission: 'DENY',
    identifyUserMethod: 'USER_ID',
    sessionTimeoutSeconds: 3600,
    anonymousTtlDays: 14,
    agentId: 'agent-1',
    // Coherent with agentId on purpose (#852). `agent: null` beside a set
    // `agentId` is the SALVAGE state — a partial payload whose `agent` relation
    // failed — not the default one, and a fixture that ships it by default
    // quietly makes every test exercise the rarer path. Tests that want the
    // divergence pass `agent: null` explicitly.
    agent: { id: 'agent-1', name: 'Agent One', urn: 'hrn:agent:one' },
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
    | 'revokeKey' | 'deleteApp' | 'castWorker' | 'retireWorker' | 'releaseWorker'
    | 'postTeamChatMessage' | 'postChannelMessage',
  fields: Record<string, string | string[]>,
  // #825 — the signed-in user, for actions whose COPY depends on whether the
  // caller is the party the server named. Defaults to absent, which is the
  // shape every earlier test ran with.
  user?: { id: string } | null,
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
    locals: { token: 'tok', user },
  } as unknown as Parameters<(typeof actions)[typeof name]>[0];
  return actions[name](event);
}

const validSettings = {
  name: 'Demo App',
  urn: 'demo-app',
  appType: 'CHATBOT',
  role: 'ADMIN',
  description: 'A demo',

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
            // #648: org-owned app → the loader fetches the org (the App-detail slice
            // below) and availableAgents = org.agents.
            organizationId: 'org-1',
            appType: 'CHATBOT',
            role: 'ADMIN',
            description: null,

            createUserPermission: 'DENY',
            identifyUserMethod: 'USER_ID',
            sessionTimeoutSeconds: 3600,
            anonymousTtlDays: 14,
            agentId: null,
            agent: null,
          },
        });
      }
      if (query === APP_DETAIL_ORG_QUERY) {
        return Promise.resolve({
          organization: { id: 'org-1', urn: 'hadronmemory.com:demo-org', name: 'Demo Org', members: [] },
        });
      }
      if (query === APP_ORG_AGENTS_QUERY) {
        return Promise.resolve({
          organization: { id: 'org-1', agents: [{ id: 'agent-1', name: 'Agent One', urn: 'agent:one' }] },
        });
      }
      if (query === APP_ORG_AGENT_GRANTS_QUERY) {
        return Promise.resolve({ organization: { id: 'org-1', agentOrgGrants: [] } });
      }
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      // #744: chat-root discovery for the Chats selector. Shares the appNodes
      // resolver but is its own document, so the strict mock needs it by name.
      if (query === APP_CHAT_ROOTS_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      if (query === TEAM_WORK_ITEMS_QUERY) {
        return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
      }
      // #1106: the viewer's manage self-audit (the Client tab's plugin grid).
      if (query === SELF_CAN_MANAGE_QUERY) return Promise.resolve({ effectiveAccess: { canManage: true } });
      throw new Error('Unexpected query');
    });

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
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
            // Coherent with agentId — see baseApp. These cases are about the STAFF
            // fetch, so they must not also stage the salvage divergence.
            agentId: 'agent-1', agent: { id: 'agent-1', name: 'Agent One', urn: 'hrn:agent:one' },
          },
        });
      }
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      if (query === TEAM_WORK_ITEMS_QUERY) {
        return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    // AI configs resolve; the workers page rejects.
    // Keyed on the collection, not on call order: since #1006 the loader also
    // pages the installable-agents pool, ahead of the staff fetch.
    mockFetchAllItems.mockImplementation((_client, _query, key) =>
      key === 'workers' ? Promise.reject(new Error('workers exploded')) : Promise.resolve([]));

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
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
            // Coherent with agentId — see baseApp. These cases are about the STAFF
            // fetch, so they must not also stage the salvage divergence.
            agentId: 'agent-1', agent: { id: 'agent-1', name: 'Agent One', urn: 'hrn:agent:one' },
          },
        });
      }
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      if (query === TEAM_WORK_ITEMS_QUERY) {
        return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
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
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
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
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0])) as {
      teamChatMessages: unknown[];
      teamChatError: boolean;
    };

    expect(result.teamChatError).toBe(true);
    expect(result.teamChatMessages).toEqual([]);
  });

  // The negative case for the above: an empty chat is NOT an error. Without
  // this, an implementation that flagged every empty transcript as failed would
  // pass the test above (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail).
  it('reports a genuinely empty team chat with no error flag', async () => {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      if (query === TEAM_WORK_ITEMS_QUERY) {
        return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);

    const { load } = await import('./+page.server');
    const result = (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0])) as {
      teamChatMessages: unknown[];
      teamChatTotal: number;
      teamChatError: boolean;
    };

    expect(result.teamChatError).toBe(false);
    expect(result.teamChatMessages).toEqual([]);
    expect(result.teamChatTotal).toBe(0);
  });

  // #1137: `?team=` is read by the loader and applied by the SERVER on the tail
  // read; an invalid value reads nothing; the server's typed refusal is carried
  // to the thread and never retried unfiltered.
  describe('team filter (#1137)', () => {
    async function loadWith(search: string, chat: (vars: Record<string, unknown>) => Promise<unknown>) {
      mockRequest.mockImplementation((query, vars) => {
        if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
        if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
        if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
        if (query === TEAM_CHAT_MESSAGES_QUERY) return chat(vars as Record<string, unknown>);
        if (query === TEAM_WORK_ITEMS_QUERY) return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
        return Promise.resolve({ resolveAiServiceConfigs: [] });
      });
      mockFetchAllItems.mockResolvedValue([]);
      const { load } = await import('./+page.server');
      return (await load({
        params: { id: 'org-1', appId: 'app-1' },
        locals: { token: 'tok', user: { id: 'user-1' } },
        parent: async () => ({}),
        depends: () => {},
        url: new URL(`http://localhost/app/apps/app-1${search}`),
      } as unknown as Parameters<typeof load>[0])) as Record<string, any>;
    }
    const teamChatCalls = () => mockRequest.mock.calls.filter((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY);

    it('reads the tail UNDER the filter and reports what it was read under', async () => {
      const r = await loadWith('?team=h1', async () => ({ teamChatMessages: { items: [], total: 0 } }));
      expect(teamChatCalls()[0][1]).toMatchObject({ teamHeadRef: 'h1' });
      expect(r.teamFilter).toEqual({ kind: 'team', headRef: 'h1' });
      expect(r.teamFilterInvalid).toBe(false);
    });

    it('sends no filter argument when the parameter is absent', async () => {
      const r = await loadWith('', async () => ({ teamChatMessages: { items: [], total: 0 } }));
      expect(teamChatCalls()[0][1]).not.toHaveProperty('teamHeadRef');
      expect(teamChatCalls()[0][1]).not.toHaveProperty('untagged');
      expect(r.teamFilter).toEqual({ kind: 'none' });
    });

    it('reads NOTHING for an invalid value, and says so, instead of serving the unfiltered thread', async () => {
      const r = await loadWith('?team=a%20b', async () => ({ teamChatMessages: { items: [], total: 0 } }));
      expect(teamChatCalls()).toHaveLength(0);
      expect(r.teamFilterInvalid).toBe(true);
      expect(r.teamChatMessages).toEqual([]);
      expect(r.teamChatError).toBe(true);
    });

    it('carries the server’s typed head refusal, and does not retry unfiltered', async () => {
      const r = await loadWith('?team=gone', async () =>
        Promise.reject(
          Object.assign(new Error('refused'), {
            response: { errors: [{ message: 'Team broadcast target is unavailable in this Channel.', extensions: { code: 'TEAM_CHAT_TEAM_HEAD_INVALID' } }] },
          }),
        ),
      );
      expect(r.teamChatRefusal).toEqual({
        code: 'TEAM_CHAT_TEAM_HEAD_INVALID',
        message: 'Team broadcast target is unavailable in this Channel.',
      });
      expect(r.teamChatError).toBe(true);
      expect(r.teamChatMessages).toEqual([]);
      expect(teamChatCalls()).toHaveLength(1);
    });

    it('names no refusal for an ordinary failure', async () => {
      const r = await loadWith('?team=h1', async () => Promise.reject(new Error('boom')));
      expect(r.teamChatRefusal).toBeNull();
      expect(r.teamChatError).toBe(true);
    });
  });

  // The server's total is what tells the tab its view is a suffix of the real
  // thread. Passing back `items.length` instead would make every truncated
  // transcript look complete.
  it('carries the server total through, not the fetched count', async () => {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
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
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
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
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      if (query === TEAM_WORK_ITEMS_QUERY) {
        return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);

    const { load } = await import('./+page.server');
    await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0]);

    const call = mockRequest.mock.calls.find((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY);
    expect(call?.[1]).toMatchObject({ appRef: 'app-1' });
  });
});

describe('update action', () => {
  it('updates app settings from a validated Superform and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('update', { ...validSettings, systemPrompt: 'stale must not be forwarded' });
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

    });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      description: null,

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
      INSTALL_AGENT_INTO_APP_MUTATION,
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

  // portal#1068 (Holger #8095): whoever manages the App mints its keys. The
  // server is the gate; the portal names the rule instead of a 500.
  it('a FORBIDDEN refusal is a 403 naming who may manage keys, not the raw server text', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
    });
    const result = (await runAction('createKey', { label: 'production' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(403);
    expect(result.data.form.message).toEqual({ type: 'error', text: APP_KEY_MANAGERS_ONLY() });
  });

  it('an impersonation session’s refusal is a 403 too, never a key', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'read-only', extensions: { code: 'IMPERSONATION_READ_ONLY' } }] },
    });
    const result = (await runAction('createKey', { label: 'production' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } }; rawKey?: string };
    };
    expect(result.status).toBe(403);
    expect(result.data.form.message.text).toBe(APP_KEY_IMPERSONATION_READ_ONLY());
    expect(result.data.rawKey).toBeUndefined();
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
      UNINSTALL_AGENT_FROM_APP_MUTATION,
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

  // portal#1106: a non-manager's tick is refused by updateApp's gate. That is
  // a permission answer, so it is a 403 naming the rule, never the raw
  // "Forbidden" in the 500 class kept for server faults.
  it('a FORBIDDEN refusal is a 403 naming who may change plugins, not a raw 500', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
    });
    const result = (await runAction('updateAgentTools', { agentTools: 'CLAUDE_CODE' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(403);
    expect(result.data.form.message).toEqual({ type: 'error', text: AGENT_TOOLS_MANAGERS_ONLY() });
    expect(result.data.form.message.text).not.toBe('Forbidden');
  });

  it('an impersonation session’s refusal is a 403 with its own copy', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'read-only', extensions: { code: 'IMPERSONATION_READ_ONLY' } }] },
    });
    const result = (await runAction('updateAgentTools', { agentTools: 'CLAUDE_CODE' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(403);
    expect(result.data.form.message.text).toBe(AGENT_TOOLS_IMPERSONATION_READ_ONLY());
  });

  it('an unknown GraphQL code stays a 500 with generic copy', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'db down', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] },
    });
    const result = (await runAction('updateAgentTools', { agentTools: 'CLAUDE_CODE' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message.text).toBe('Something went wrong on our side.');
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

  it('a FORBIDDEN revoke is a 403 with the same manager copy', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
    });
    const result = (await runAction('revokeKey', { keyId: 'key-1' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(403);
    expect(result.data.form.message).toEqual({ type: 'error', text: APP_KEY_MANAGERS_ONLY() });
    // The copy is generic: it never echoes the key it refused.
    expect(result.data.form.message.text).not.toContain('key-1');
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

// ── Casting (#974, hrn:node:hadronmemory.com:specs:cor:dmo:050:11) ──────────────────────────────────────────
//
// castWorker CASTS an agent that is already installed; it mints nothing.
//
// #760: `name` is REQUIRED. hadron-server#1050 removed the cast-list register,
// so "omit the name and the server picks one" is gone — the server refuses a
// nameless cast with WORKER_NAME_REQUIRED. The interesting behaviour is now
// asymmetric, and that asymmetry is what these tests hold up:
//
//   name — rejected client-side when blank, never coerced
//   role — omitted entirely under R222, including stale posted overrides

describe('castWorker action', () => {
  it('casts an installed agent without forwarding a stale role override', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('castWorker', {
      agentId: 'agent-1',
      name: 'Iris',
      role: 'backend-engineer',
      promptOverride: 'stale must not be forwarded',
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

      },
    ]);
  });

  // RATCHET FLIPPED, not deleted (hrn:node:hadronmemory.com:hadron-server:review:convention-ratchets-must-be-flipped).
  // This asserted that a blank name reached the mutation as `undefined` —
  // correct while an omitted name walked the register, and the exact behaviour
  // #760 reports as broken now that hadron-server#1050 removed it. The
  // name invariant still holds under R222.
  it('rejects a blank name BEFORE the mutation, rather than coercing it', async () => {
    const result = (await runAction('castWorker', {
      agentId: 'agent-1',
      name: '',
      role: '',
    })) as { status: number; data: { form: { errors: { name?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.name?.[0]).toMatch(/name/i);
    // The point of the fix: the request the server would refuse is never sent.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('omits role entirely from the schema, mutation and variables', async () => {
    // R222: no writable role survives at any layer of this form.
    mockRequest.mockResolvedValueOnce({});
    await runAction('castWorker', { agentId: 'agent-1', name: 'Iris', role: '' });
    const vars = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(vars).not.toHaveProperty('role');
    expect(castWorkerSchema.shape).not.toHaveProperty('role');
    expect(CAST_WORKER_MUTATION).not.toMatch(/\$role|role:\s*\$role/);
    expect(vars.name).toBe('Iris');
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

  // #760: WORKER_NAME_REQUIRED had NO mapping — it replaced
  // WORKER_REGISTER_EXHAUSTED when hadron-server#1050 removed the register, so
  // the one refusal a user could actually hit fell through to the raw server
  // string. The form now blocks it client-side, which is why this asserts the
  // SERVER refusal is still translated: if the two ever drift, the screen
  // should carry a sentence rather than a code.
  it('translates WORKER_NAME_REQUIRED, which replaced the register refusal', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ extensions: { code: 'WORKER_NAME_REQUIRED' } }] },
    });
    const result = (await runAction('castWorker', { agentId: 'agent-1', name: 'Iris' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toMatch(/needs a name/i);
    // The dead register vocabulary must not come back with it.
    expect(result.data.form.message.text).not.toMatch(/cast list|register/i);
  });

  it('translates a stale-client role override refusal', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'WORKER_ROLE_OVERRIDE_REFUSED', extensions: { code: 'WORKER_ROLE_OVERRIDE_REFUSED' } }] },
    });
    const result = (await runAction('castWorker', { agentId: 'agent-1', name: 'Iris', role: 'old-role' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toBe('A worker’s role comes from its agent. Reload this page and choose the agent for the role you need.');
  });

  it('translates WORKER_AGENT_NOT_INSTALLED', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ extensions: { code: 'WORKER_AGENT_NOT_INSTALLED' } }] },
    });
    const result = (await runAction('castWorker', { agentId: 'agent-9', name: 'Iris' })) as {
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
    const result = (await runAction('castWorker', { agentId: 'agent-1', name: 'Iris' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toContain('permission to staff this App');
    expect(result.data.form.message.text).toContain('contributor access');
  });

  it('uses generic copy for an UNKNOWN code', async () => {
    // hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only — only known codes get friendly
    // copy; an internal error must not be relabelled as a user mistake.
    mockRequest.mockRejectedValueOnce({
      message: 'boom',
      response: { errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] },
    });
    const result = (await runAction('castWorker', { agentId: 'agent-1', name: 'Iris' })) as {
      data: { form: { message: { text: string } } };
    };
    expect(result.data.form.message.text).toBe('Something went wrong on our side.');
  });

  it('falls back to the server message for a payload-less transport failure', async () => {
    // No `response.errors` at all — reading extensions.code off it would yield
    // undefined and, with a catch-all, mislabel an outage.
    mockRequest.mockRejectedValueOnce(new Error('bad gateway'));
    const result = (await runAction('castWorker', { agentId: 'agent-1', name: 'Iris' })) as {
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

// #756 / hadron-server#1050 — releasing a HELD name. The tests exist to hold
// apart two operations the issue originally proposed merging: releasing leaves
// the worker ACTIVE and its name allocated, while retiring ends the casting and
// reserves the name forever.
describe('releaseWorker action', () => {
  /**
   * #823 — run the action against a `ReleaseWorkerPayload` and return the
   * message it produced. The payload is what decides the copy now, so every
   * case below states one rather than an empty object.
   */
  async function release(payload: {
    releasedFrom?: { id: string } | null;
    notified?: boolean | null;
  }) {
    mockRequest.mockResolvedValueOnce({
      releaseWorker: {
        worker: { id: 'worker-1' },
        forced: false,
        releasedFrom: null,
        notified: null,
        ...payload,
      },
    });
    const result = await runAction('releaseWorker', {
      workerId: 'worker-1',
      expectedHolderUserId: 'user-9',
    });
    return (result as { form: { message: { type: string; outcome?: string; text: string } } })
      .form.message;
  }

  const HELD_BY = { id: 'user-9' };

  it('releases a held name and says the worker stays active', async () => {
    const message = await release({ releasedFrom: HELD_BY });
    expect(mockRequest.mock.calls[0]).toEqual([
      RELEASE_WORKER_MUTATION,
      // #825 — the asserted hold rides with every release now.
      { workerRef: 'worker-1', expectedHolderUserId: 'user-9' },
    ]);
    expect(message).toMatchObject({ type: 'success', outcome: 'released' });
    expect(message.text).toContain('stays active');
    // The distinction is the whole point: releasing must never claim to have
    // retired anything, or the two operations start reading as one.
    expect(message.text).not.toContain('reserved');
  });

  // The defect #823 reports: the action discarded the result and always said
  // "Name released.", so an idempotent no-op on an UNHELD worker reported a
  // release that never happened.
  it('does not claim a release when nothing was held', async () => {
    const message = await release({ releasedFrom: null });
    expect(message).toMatchObject({ type: 'success', outcome: 'not-held' });
    expect(message.text).not.toContain('Name released');
    expect(message.text).toContain('nobody held that name');
  });

  // `notified: false` means the team-chat notice
  // `hrn:node:hadronmemory.com:specs:cor:agt:020:09` requires was OWED AND FAILED. The release stands; the half other people rely on did not
  // happen, and it used to render as plain success.
  it('warns when the owed team-chat announcement failed to post', async () => {
    const message = await release({ releasedFrom: HELD_BY, notified: false });
    expect(message).toMatchObject({ type: 'success', outcome: 'announcement-failed' });
    expect(message.text).toContain('did not post');
    // It still reports the release, because the release DID happen — the
    // warning is additional, not a replacement.
    expect(message.text).toContain('Name released');
  });

  // `null` is "no notice was owed" (a self-release), NOT a failure. A falsy
  // check rather than `=== false` would warn about an announcement nobody ever
  // expected, on the most common path there is.
  it('treats an un-owed announcement as an ordinary release, not a failure', async () => {
    const notOwed = await release({ releasedFrom: HELD_BY, notified: null });
    const posted = await release({ releasedFrom: HELD_BY, notified: true });
    expect(notOwed.outcome).toBe('released');
    expect(posted.outcome).toBe('released');
    expect(notOwed.text).not.toContain('did not post');
    expect(posted.text).not.toContain('did not post');
  });

  // Pins the mapping rather than any one wording: three outcomes that share a
  // sentence are a collapse, which is the shape of the original defect. A test
  // that pinned only the strings would pass on a mapping that returned the same
  // text for two of them.
  it('gives each outcome its own message', async () => {
    const texts = [
      (await release({ releasedFrom: HELD_BY })).text,
      (await release({ releasedFrom: HELD_BY, notified: false })).text,
      (await release({ releasedFrom: null })).text,
    ];
    expect(new Set(texts).size).toBe(3);
  });

  // @codex on PR #824, and the claim was in ALL THREE messages rather than the
  // one line flagged. "anyone may hold it now" describes a MUTABLE GLOBAL at the
  // moment the sentence is read: `ReleaseWorkerPayload.worker.heldByUserId` may
  // already carry a LATER hold, so a reader can be told the name is theirs for
  // the taking and be refused `WORKER_HELD` on the very next click. What the
  // action observed is that a hold ENDED, and that releasing reserves nothing.
  //
  // The patterns are proxies for that class, not the wording of one branch — a
  // test pinning the sentence would pass on the next sentence that promises the
  // same thing, which is how the tooltip on #822 ended up enforcing its own
  // defect.
  it('never promises the name is available to take', async () => {
    const texts = [
      (await release({ releasedFrom: HELD_BY })).text,
      (await release({ releasedFrom: HELD_BY, notified: false })).text,
      (await release({ releasedFrom: null })).text,
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/anyone/i);
      expect(text).not.toMatch(/may hold/i);
      expect(text).not.toMatch(/\bnow\b/i);
    }
  });

  it('calls releaseWorker, never retireWorker', async () => {
    // Guards the collision #756 proposed: a "Release" button wired to
    // retireWorker would end the casting and reserve the name forever, which is
    // unrecoverable and looks like a success.
    await release({ releasedFrom: HELD_BY });
    expect(mockRequest.mock.calls[0][0]).toBe(RELEASE_WORKER_MUTATION);
    expect(mockRequest.mock.calls[0][0]).not.toBe(RETIRE_WORKER_MUTATION);
  });

  // ─── #825: the guarded write ──────────────────────────────────────────
  //
  // The roster is a snapshot and this page does not poll, so an UNGUARDED
  // release acts on whoever holds the name when the click lands — and the admin
  // path announces that person in the team chat. These pin the assertion going
  // out and each reading of the refusal coming back.

  it('asserts WHICH hold it is releasing, and never asserts "expect nobody" too', async () => {
    mockRequest.mockResolvedValueOnce({
      releaseWorker: { worker: { id: 'worker-1' }, forced: false, releasedFrom: HELD_BY, notified: null },
    });
    await runAction('releaseWorker', { workerId: 'worker-1', expectedHolderUserId: 'user-9' });
    const vars = mockRequest.mock.calls[0][1] as Record<string, unknown>;
    expect(vars).toMatchObject({ workerRef: 'worker-1', expectedHolderUserId: 'user-9' });
    // Passing BOTH assertions is BAD_USER_INPUT server-side, and this control
    // only ever renders for a KNOWN hold, so "expect nobody" is never what this
    // page means. Absent, not false — a present `false` is still an assertion.
    expect(vars).not.toHaveProperty('expectUnheld');
  });

  // The guard is only a guard if it cannot be omitted. A release with no
  // asserted holder is the unconditional write that WAS the defect, so it fails
  // loudly here rather than reaching the server unguarded.
  it('refuses to release at all when no hold was asserted', async () => {
    const result = (await runAction('releaseWorker', { workerId: 'worker-1' })) as { status: number };
    expect(result.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  function staleRefusal(extensions: Record<string, unknown>) {
    return {
      response: {
        errors: [{ message: 'hold is stale', extensions: { code: 'WORKER_HOLD_STALE', workerId: 'worker-1', ...extensions } }],
      },
    };
  }

  async function releaseAgainst(extensions: Record<string, unknown>, user?: { id: string } | null) {
    mockRequest.mockRejectedValueOnce(staleRefusal(extensions));
    return (await runAction(
      'releaseWorker',
      { workerId: 'worker-1', expectedHolderUserId: 'user-9' },
      user,
    )) as { status?: number; data?: { form: { message: StaleMessage } }; form?: { message: StaleMessage } };
  }

  type StaleMessage = { type: string; outcome?: string; staleHold?: true; text: string };

  function messageOf(result: { data?: { form: { message: StaleMessage } }; form?: { message: StaleMessage } }): StaleMessage {
    // A 200 carries `form` directly; a fail() nests it under `data`.
    return result.data?.form.message ?? result.form!.message;
  }

  // `heldByUserId: null` is a definite "nobody holds it now": the end state the
  // user asked for already stands, so this is not an error for them to act on.
  it('reports a hold that had already ended as nothing-to-release, not a failure', async () => {
    const message = messageOf(await releaseAgainst({ heldByUserId: null }, { id: 'user-1' }));
    expect(message).toMatchObject({ type: 'success', outcome: 'not-held', staleHold: true });
    expect(message.text).not.toContain('Name released');
  });

  // The server throws BEFORE comparing the holder to the caller and will not
  // say whose hold it is — so the client decides. Getting this wrong is the
  // #766 mistake in a new place: describing an act the user is not performing.
  it('does not call it a force-release when the name came to the caller', async () => {
    const result = await releaseAgainst({ heldByUserId: 'user-1' }, { id: 'user-1' });
    expect(result.status).toBe(409);
    const message = messageOf(result);
    expect(message).toMatchObject({ type: 'error', staleHold: true });
    expect(message.text).toContain('your own account');
    expect(message.text).not.toContain('team chat');
  });

  it('says a different holder was found, without naming or accusing them', async () => {
    const result = await releaseAgainst({ heldByUserId: 'user-2' }, { id: 'user-1' });
    expect(result.status).toBe(409);
    const message = messageOf(result);
    expect(message).toMatchObject({ type: 'error', staleHold: true });
    expect(message.text).toContain('team chat');
    // The portal cannot name the holder (portal#748) and must not imply the
    // hold was taken from anyone.
    expect(message.text).not.toContain('user-2');
  });

  // An unreadable payload must not be guessed at. It falls through to ordinary
  // error handling, which carries the server's own message.
  it('falls back to ordinary error handling when the refusal cannot be read', async () => {
    const result = await releaseAgainst({}, { id: 'user-1' });
    expect(result.status).toBe(500);
    const message = messageOf(result);
    expect(message.text).toBe('Something went wrong on our side.');
    expect(message).not.toHaveProperty('staleHold');
  });

  it('rejects a missing worker id before the mutation', async () => {
    const result = (await runAction('releaseWorker', {})) as { status: number };
    expect(result.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when releasing fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('releaseWorker', { workerId: 'worker-1', expectedHolderUserId: 'user-9' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });

  // releaseWorker does NOT share the staffing gate: it admits the HOLDER or an
  // App/org ADMIN, while casting and retiring also admit a contributor. Reusing
  // the staffing copy told a contributor who is not the holder that they
  // already had the access they lacked (@codex + @copilot on #766).
  it('gives release-specific FORBIDDEN copy, not the staffing gate copy', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
    });
    const result = (await runAction('releaseWorker', { workerId: 'worker-1', expectedHolderUserId: 'user-9' })) as {
      data: { form: { message: { text: string } } };
    };
    const text = result.data.form.message.text;
    expect(text).toContain('release a name you hold yourself');
    expect(text).toContain('admin access');
    expect(text).not.toContain('permission to staff this App');
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

  // hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only — an unknown code (or a transport
  // failure with no GraphQL payload) must fall through to the server's own
  // message rather than being relabelled as a user mistake.
  it('uses generic copy for an unmapped code', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('SOME_NEW_CODE'));
    const result = (await runAction('postTeamChatMessage', {
      _kind: 'postTeamChatMessage',
      body: 'hi',
    })) as { data: { form: { message: { text: string } } } };
    expect(result.data.form.message.text).toContain('Something went wrong on our side.');
  });
});

describe('worklog loading (#733)', () => {
  /**
   * `worklog` may carry an `appChatRoots` key (#744) to drive chat discovery —
   * an Error to make it fail, or an array of chat-root nodes. Kept on the same
   * argument so the existing single-purpose calls read unchanged.
   */
  function stubAll(worklog: Record<string, unknown> | Error) {
    const chatRoots = (worklog as Record<string, unknown>)?.appChatRoots;
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === APP_CHAT_ROOTS_QUERY) {
        if (chatRoots instanceof Error) return Promise.reject(chatRoots);
        return Promise.resolve({ appNodes: chatRoots ?? [] });
      }
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      if (query === TEAM_WORK_ITEMS_QUERY) {
        return worklog instanceof Error ? Promise.reject(worklog) : Promise.resolve(worklog);
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);
  }

  async function loadWithUrl(search: string) {
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL(`http://localhost/app/apps/app-1${search}`),
    } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
  }

  it('passes ref, kind and tool filters through to the server', async () => {
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    await loadWithUrl('?worklogRef=owner/repo%23371&worklogKind=pr&worklogTool=github');
    const call = mockRequest.mock.calls.find((c) => c[0] === TEAM_WORK_ITEMS_QUERY);
    expect(call?.[1]).toMatchObject({
      appRef: 'app-1',
      ref: 'owner/repo#371',
      kind: 'pr',
      tool: 'github',
    });
  });

  // teamWorkItems REFUSES an unknown kind, so forwarding a stray query param
  // would turn a bookmarked or hand-edited URL into an error page instead of an
  // unfiltered list.
  it('drops an invalid kind rather than forwarding it into a server error', async () => {
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    const result = await loadWithUrl('?worklogKind=pull-request');
    const call = mockRequest.mock.calls.find((c) => c[0] === TEAM_WORK_ITEMS_QUERY);
    expect(call?.[1].kind).toBeUndefined();
    // And the echoed-back filter must not claim a filter that was never applied.
    expect((result.worklogFilters as { kind: string }).kind).toBe('');
  });

  it('reports a failed worklog fetch as an error, not as an empty worklog', async () => {
    stubAll(new Error('worklog exploded'));
    const result = await loadWithUrl('');
    expect(result.worklogError).toBe(true);
    expect(result.worklog).toEqual([]);
  });

  // Negative case for the above (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail).
  it('reports a genuinely empty worklog with no error flag', async () => {
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    const result = await loadWithUrl('');
    expect(result.worklogError).toBe(false);
    expect(result.worklogTotal).toBe(0);
  });

  it('carries the server total through, not the fetched count', async () => {
    stubAll({ teamWorkItems: { items: [{ nodeId: 'n1' }], total: 412 } });
    const result = await loadWithUrl('');
    expect((result.worklog as unknown[]).length).toBe(1);
    expect(result.worklogTotal).toBe(412);
  });

  it('resolves a known ?tab= so a filtered worklog URL lands on the worklog', async () => {
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    expect((await loadWithUrl('?tab=worklog')).initialTab).toBe('worklog');
  });

  // An unknown tab must fall back to the page default, not render a page where
  // no tab body matches.
  it('coerces an unknown ?tab= to null', async () => {
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    expect((await loadWithUrl('?tab=nonsense')).initialTab).toBeNull();
    expect((await loadWithUrl('')).initialTab).toBeNull();
  });

  /**
   * #744 merged the `chat` and `team-chat` tabs into one `chats` tab. Those ids
   * are in the wild — PR descriptions, team-chat messages, bookmarks — so they
   * must still land somewhere sensible with the right conversation selected.
   * Dropping them would silently show the default tab instead, which looks like
   * the link worked.
   */
  it('keeps the retired ?tab=chat and ?tab=team-chat links working', async () => {
    stubAll({ teamWorkItems: { items: [], total: 0 } });

    const agent = await loadWithUrl('?tab=chat');
    expect(agent.initialTab).toBe('chats');
    expect(agent.selectedChatKey).toBe('agent chat');

    const team = await loadWithUrl('?tab=team-chat');
    expect(team.initialTab).toBe('chats');
    expect(team.selectedChatKey).toBe('chats:team');
  });

  // `?view=full` opens the team chat maximised; parsed in the loader beside
  // `?tab=` and `?chat=` so the page reads all its URL state from one place.
  it('reads ?view=full as the maximised team chat, and anything else as the tab', async () => {
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    expect((await loadWithUrl('?tab=chats&chat=chats%3Ateam&view=full')).initialChatFullView).toBe(true);
    expect((await loadWithUrl('?tab=chats&chat=chats%3Ateam')).initialChatFullView).toBe(false);
    expect((await loadWithUrl('?view=huge')).initialChatFullView).toBe(false);
  });

  it('lets an explicit ?chat= win over the one a retired tab implies', async () => {
    // A link carrying both is not silently overridden by the alias.
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    const r = await loadWithUrl('?tab=team-chat&chat=agent%20chat');
    expect(r.initialTab).toBe('chats');
    expect(r.selectedChatKey).toBe('agent chat');
  });

  it('reports a ?chat= it could not honour instead of substituting silently', async () => {
    // The reader followed a link to a specific conversation; showing a
    // different one without saying so lets them misread whose chat it is.
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    const r = await loadWithUrl('?tab=chats&chat=chats:gone');
    expect(r.chatNotFound).toBe(true);
    expect(r.selectedChatKey).not.toBe('chats:gone');
  });

  it('does not raise chatNotFound for a chat that resolves', async () => {
    // Negative case (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail).
    stubAll({ teamWorkItems: { items: [], total: 0 } });
    const r = await loadWithUrl('?tab=chats&chat=chats:team');
    expect(r.chatNotFound).toBe(false);
    expect(r.selectedChatKey).toBe('chats:team');
  });

  it('distinguishes a failed chat-root discovery from an App with one chat', async () => {
    stubAll({ teamWorkItems: { items: [], total: 0 }, appChatRoots: new Error('down') });
    const r = await loadWithUrl('');
    expect(r.chatsError).toBe(true);
    // The team chat is still offered — it always is, bootstrapped or not.
    expect((r.appChats as { key: string }[]).some((c) => c.key === 'chats:team')).toBe(true);
  });
});
// The App page opens on one bounded newest page, independent of whether the
// server's cursor-less default is still oldest-first or has flipped in #1536.
describe('team chat tail paging (#1536)', () => {
  function stubChat(page: { items: unknown[]; total: number }) {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp() });
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
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
      // A hand-built event is a PARTIAL fake of the real one, so every load
      // param the route uses has to be added here — `depends` surfaced as
      // `depends is not a function` across 23 cases at once when #754 added it.
      // #785 removed the route's use of it; the stub stays because the next
      // param to be added will need this comment more than the churn is worth.
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
  }

  it('makes one request for the newest 20 even when the chat is long', async () => {
    const newest = Array.from({ length: 20 }, (_, i) => ({ nodeId: `n${i + 481}`, seq: i + 481 }));
    stubChat({ items: newest, total: 500 });

    const result = await runLoad();
    const chatCalls = mockRequest.mock.calls.filter((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY);
    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0][1]).toEqual({ appRef: 'app-1', beforeSeq: 2147483647, limit: 20 });
    expect((result.teamChatMessages as Array<{ seq: number }>)[0].seq).toBe(481);
    expect(result.teamChatTotal).toBe(500);
  });

  it('also makes only one request when the whole chat fits in a page', async () => {
    stubChat({ items: [{ nodeId: 'n1', seq: 1 }], total: 1 });
    await runLoad();
    expect(mockRequest.mock.calls.filter((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY)).toHaveLength(1);
  });

  it('does not re-fetch when the chat is exactly the page size', async () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ nodeId: `n${i + 1}`, seq: i + 1 }));
    stubChat({ items, total: 20 });
    await runLoad();
    expect(mockRequest.mock.calls.filter((c) => c[0] === TEAM_CHAT_MESSAGES_QUERY)).toHaveLength(1);
  });
});

// portal#1106 — whether the viewer may change the App's plugins comes from the
// server: a self-audit of the App (`effectiveAccess.canManage`), whose App arm
// grants manage to exactly the principals updateApp's gate admits. `null` is
// "unknown", never "no": the page keeps the controls and the server answers.
describe('canManageApp (#1106)', () => {
  function stub(manage: { canManage: boolean } | Error) {
    mockRequest.mockImplementation((query, vars) => {
      if (query === APP_QUERY) return Promise.resolve({ app: baseApp({ urn: 'hrn:app:acme.com:demo' }) });
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      if (query === SELF_CAN_MANAGE_QUERY) {
        expect(vars).toEqual({ user: 'user-1', resource: 'hrn:app:acme.com:demo' });
        return manage instanceof Error ? Promise.reject(manage) : Promise.resolve({ effectiveAccess: manage });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);
  }

  async function runLoad(user: { id: string } | null = { id: 'user-1' }) {
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user },
      parent: async () => ({}),
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
  }

  it('is false when the server says the viewer cannot manage the App', async () => {
    stub({ canManage: false });
    expect((await runLoad()).canManageApp).toBe(false);
  });

  it('is true for a manager', async () => {
    stub({ canManage: true });
    expect((await runLoad()).canManageApp).toBe(true);
  });

  it('is null, not false, when the self-audit fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    stub(new Error('down'));
    expect((await runLoad()).canManageApp).toBeNull();
  });

  it('is null without a signed-in user, and asks nothing', async () => {
    stub({ canManage: true });
    expect((await runLoad(null)).canManageApp).toBeNull();
    expect(mockRequest.mock.calls.some((c) => c[0] === SELF_CAN_MANAGE_QUERY)).toBe(false);
  });
});

/**
 * #851 — the org lookup on an org-owned App classifies its failures.
 *
 * The loader used to fetch the org with `.catch(() => ({ organization: null }))`
 * and 404 on the null. That catch took no argument, so nothing was classified:
 * an outage, a bad gateway, a resolver crash and a genuine refusal all rendered
 * "Organization not found", which during an outage was every org-owned App page.
 *
 * Pinned in BOTH directions with the SAME `orgRefusal` builder, deliberately: if
 * that builder produced a shape `extractGqlErrorCode` cannot read, every code
 * would look like `null`, the rethrow cases would still pass and only the 404
 * cases would fail. One direction alone ratifies a broken fixture — the lesson
 * from #850's sibling test on `/app/orgs/[id]`.
 */
describe('#851 — the App-detail org lookup classifies its failures', () => {
  /** A graphql-request rejection as the server actually delivers one. */
  function orgRefusal(code: string, message = 'nope') {
    return Object.assign(new Error(`${message}: ${JSON.stringify({ code })}`), {
      response: { errors: [{ message, extensions: { code } }] },
    });
  }

  const ORG = { id: 'org-1', name: 'Demo Org', urn: 'hrn:org:demo', members: [], agents: [] };

  /**
   * `outcome` is an explicit {resolve}|{reject} rather than "an Error means
   * reject", because a graphql-request rejection IS an object with a `response`
   * key and so is a successful payload — sniffing would couple the harness to
   * the shape under test.
   */
  function stubOrg(
    outcome: { resolve: unknown } | { reject: unknown },
    appOver: Record<string, unknown> = {},
    agentsOutcome?: { resolve: unknown } | { reject: unknown },
    grantsOutcome?: { resolve: unknown } | { reject: unknown },
  ) {
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) {
        return Promise.resolve({ app: baseApp({ organizationId: 'org-1', ...appOver }) });
      }
      if (query === APP_DETAIL_ORG_QUERY) {
        return 'reject' in outcome ? Promise.reject(outcome.reject) : Promise.resolve(outcome.resolve);
      }
      // #1006: the install picker's agents are a request of their own.
      if (query === APP_ORG_AGENTS_QUERY) {
        if (agentsOutcome) {
          return 'reject' in agentsOutcome ? Promise.reject(agentsOutcome.reject) : Promise.resolve(agentsOutcome.resolve);
        }
        return Promise.resolve({ organization: { id: 'org-1', agents: [] } });
      }
      // #1172: the subscribed agents, a request of their own.
      if (query === APP_ORG_AGENT_GRANTS_QUERY) {
        if (grantsOutcome) {
          return 'reject' in grantsOutcome ? Promise.reject(grantsOutcome.reject) : Promise.resolve(grantsOutcome.resolve);
        }
        return Promise.resolve({ organization: { id: 'org-1', agentOrgGrants: [] } });
      }
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === APP_CHAT_ROOTS_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) {
        return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      }
      if (query === TEAM_WORK_ITEMS_QUERY) {
        return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
      }
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    mockFetchAllItems.mockResolvedValue([]);
  }

  async function loadAndCatch() {
    const { load } = await import('./+page.server');
    try {
      return {
        thrown: undefined as unknown,
        result: await load({
          params: { id: 'org-1', appId: 'app-1' },
          locals: { token: 'tok', user: { id: 'user-1' } },
          parent: async () => ({}),
          depends: () => {},
          url: new URL('http://localhost/app/apps/app-1'),
        } as unknown as Parameters<typeof load>[0]),
      };
    } catch (e) {
      return { thrown: e, result: undefined };
    }
  }

  describe('a code meaning the org is not openable → the pre-existing 404', () => {
    it.each([
      ['ORGANIZATION_NOT_FOUND', 'the App references an org that resolved to nothing'],
      ['FORBIDDEN', 'the caller can see the App but not its org'],
    ])('%s → 404 (%s)', async (code) => {
      stubOrg({ reject: orgRefusal(code) });
      const { thrown } = await loadAndCatch();
      expect((thrown as { status: number }).status).toBe(404);
      expect((thrown as { body?: { message?: string } }).body?.message).toBe('Organization not found');
    });

    it('a cleanly null org is still this page\'s 404', async () => {
      // Not the org-less (spec 047) case: `organizationId` is set, so a null org
      // is a real error. Mislabelling it as personal would point the breadcrumb
      // at "My apps" and hide org-derived controls.
      stubOrg({ resolve: { organization: null } });
      expect(((await loadAndCatch()).thrown as { status: number }).status).toBe(404);
    });
  });

  describe('anything else propagates → 500, not a false "not found"', () => {
    it('INTERNAL_SERVER_ERROR is rethrown — the defect this issue is about', async () => {
      // A resolver crash is not a fact about the org. Before #851 this rendered
      // "Organization not found", which is a confident false statement about
      // the reader's own data.
      const crash = orgRefusal('INTERNAL_SERVER_ERROR', 'boom');
      stubOrg({ reject: crash });
      const { thrown } = await loadAndCatch();
      expect(thrown).toBe(crash);
      expect((thrown as { status?: number }).status).toBeUndefined();
    });

    it('a transport failure with no GraphQL payload is rethrown — the outage case', async () => {
      // The headline: during an outage graphql-request rejects with a plain
      // Error carrying no `response`, so there is no code to read. Nothing here
      // can be a refusal — a refusal is something a working server decided.
      const boom = new Error('fetch failed');
      stubOrg({ reject: boom });
      const { thrown } = await loadAndCatch();
      expect(thrown).toBe(boom);
      expect((thrown as { status?: number }).status).toBeUndefined();
    });

    it('a ref-shape refusal is rethrown, because the ref came from the SERVER', async () => {
      // `/app/orgs/[id]` answers URN_NOT_QUALIFIED with a 404 — correctly, its
      // ref is a route param a human typed. Here the ref is `app.organizationId`,
      // handed to us by the server, so a malformed one is a server fault and a
      // 404 would blame the reader for it.
      const malformed = orgRefusal('URN_NOT_QUALIFIED');
      stubOrg({ reject: malformed });
      expect((await loadAndCatch()).thrown).toBe(malformed);
    });
  });

  describe('the document asks only for what the page renders', () => {
    const POOL = [{ id: 'a1', name: 'One', urn: 'hrn:agent:one' }];

    it('an App with no Agent yet gets the installable agents, from a request of their own', async () => {
      stubOrg({ resolve: { organization: ORG } }, { agentId: null, agent: null }, { resolve: { organization: { id: 'org-1', agents: POOL } } });
      const { result } = await loadAndCatch();
      expect(mockRequest).toHaveBeenCalledWith(APP_ORG_AGENTS_QUERY, { ref: 'org-1' });
      expect((result as { availableAgents: unknown[] }).availableAgents).toEqual(POOL);
    });

    it('an App that already has an Agent still gets them: the Agents tab adds another (#1006)', async () => {
      stubOrg(
        { resolve: { organization: ORG } },
        { agentId: 'agent-1', agent: { id: 'agent-1', name: 'Linked', urn: 'hrn:agent:linked' } },
        { resolve: { organization: { id: 'org-1', agents: POOL } } },
      );
      const { result } = await loadAndCatch();
      expect((result as { availableAgents: unknown[]; availableAgentsError: boolean }).availableAgents).toEqual(POOL);
      expect((result as { availableAgentsError: boolean }).availableAgentsError).toBe(false);
    });

    // #1172: an Agent the org SUBSCRIBES to is an AgentOrgGrant, not one of
    // organization.agents, yet installAgentIntoApp accepts it. The picker must
    // offer it, once, and only while the grant is active and the agent readable.
    it('offers the agents the org subscribes to, beside the ones it owns (#1172)', async () => {
      const SUBSCRIBED = { id: 'a2', name: 'Project Manager', urn: 'hrn:agent:hadronmemory.com:project-manager' };
      stubOrg(
        { resolve: { organization: ORG } },
        {},
        { resolve: { organization: { id: 'org-1', agents: POOL } } },
        {
          resolve: {
            organization: {
              id: 'org-1',
              agentOrgGrants: [
                { isActive: true, agent: SUBSCRIBED },
                { isActive: true, agent: POOL[0] },
                { isActive: false, agent: { id: 'a3', name: 'Revoked', urn: 'hrn:agent:revoked' } },
                { isActive: true, agent: null },
                { isActive: true, revokedAt: '2026-01-01T00:00:00Z', agent: { id: 'a4', name: 'Swept late', urn: 'hrn:agent:late' } },
                { isActive: true, expiresAt: '2020-01-01T00:00:00Z', agent: { id: 'a5', name: 'Expired', urn: 'hrn:agent:expired' } },
              ],
            },
          },
        },
      );
      const { result } = await loadAndCatch();
      expect((result as { availableAgents: unknown[] }).availableAgents).toEqual([...POOL, SUBSCRIBED]);
      expect((result as { subscribedAgentsError: boolean }).subscribedAgentsError).toBe(false);
    });

    // portal#1188 review (George): agentOrgGrants is a non-null list, so folded
    // into the agents document its failure nulled `organization` and emptied
    // the LEGAL owned picker. It is a request of its own: a failure costs only
    // the subscribed agents.
    it('a failing grants resolver still leaves the owned picker, and says the subscribed ones are missing', async () => {
      stubOrg(
        { resolve: { organization: ORG } },
        {},
        { resolve: { organization: { id: 'org-1', agents: POOL } } },
        { reject: orgRefusal('INTERNAL_SERVER_ERROR') },
      );
      const { thrown, result } = await loadAndCatch();
      expect(thrown).toBeUndefined();
      const r = result as { availableAgents: unknown[]; availableAgentsError: boolean; subscribedAgentsError: boolean };
      expect(r.availableAgents).toEqual(POOL);
      expect(r.availableAgentsError).toBe(false);
      expect(r.subscribedAgentsError).toBe(true);
    });

    it('a failing OWNED read is still the picker error, whatever the grants say', async () => {
      stubOrg({ resolve: { organization: ORG } }, {}, { reject: orgRefusal('INTERNAL_SERVER_ERROR') }, { resolve: { organization: { id: 'org-1', agentOrgGrants: [] } } });
      const { result } = await loadAndCatch();
      expect((result as { availableAgentsError: boolean }).availableAgentsError).toBe(true);
      expect((result as { subscribedAgentsError: boolean }).subscribedAgentsError).toBe(false);
    });

    it('a refusing agents resolver costs the picker, not the page', async () => {
      // `agents` is a non-null list: folded into the org document its failure
      // would null the org and 404 the page over data one tab draws (#851).
      // hrn:node:hadronmemory.com:hadron-portal:review:a-route-must-not-invoke-a-resolver-it-does-not-render
      stubOrg({ resolve: { organization: ORG } }, {}, { reject: orgRefusal('INTERNAL_SERVER_ERROR') });
      const { thrown, result } = await loadAndCatch();
      expect(thrown).toBeUndefined();
      expect((result as { availableAgents: unknown[] }).availableAgents).toEqual([]);
      expect((result as { availableAgentsError: boolean }).availableAgentsError).toBe(true);
    });

    it('a HANGING agents or members request cannot hold the page (step 5 P2)', async () => {
      vi.useFakeTimers();
      try {
        const never = new Promise(() => {});
        stubOrg({ resolve: { organization: ORG } }, {}, { resolve: never });
        const base = mockRequest.getMockImplementation()!;
        mockRequest.mockImplementation((query, ...rest) =>
          query === APP_MEMBERS_QUERY ? never : base(query, ...rest),
        );
        const pending = loadAndCatch();
        // The loader's own awaits (dynamic import, the org lookup) must reach the
        // bounded requests before the clock can fire them.
        for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS);
        const { thrown, result } = await pending;
        expect(thrown).toBeUndefined();
        const r = result as { availableAgentsError: boolean; membersError: boolean; availableAgents: unknown[] };
        expect(r.availableAgentsError).toBe(true);
        expect(r.membersError).toBe(true);
        expect(r.availableAgents).toEqual([]);
      } finally {
        vi.useRealTimers();
      }
    });

    it('neither document selects a list the page never draws', () => {
      // Asserted on the documents themselves rather than on a call, because the
      // defect was in what the loader ASKED FOR. `ORGANIZATION_QUERY` pulled
      // memories, subscriptions and exchangeConnections — three more non-null
      // lists, each able to null the org and 404 this page on its own.
      for (const doc of [APP_DETAIL_ORG_QUERY]) {
        for (const unrendered of ['memories', 'subscriptions', 'exchangeConnections']) {
          expect(doc).not.toMatch(new RegExp(`\\b${unrendered}\\b`));
        }
        // The other direction: a document that selected nothing would pass the
        // check above and break the breadcrumb on every org-owned App.
        for (const rendered of ['id', 'name', 'urn', 'members']) {
          expect(doc).toMatch(new RegExp(`\\b${rendered}\\b`));
        }
      }
    });

    it('only the agents document carries `agents`', async () => {
      // @copilot on #852: `agents` creeping back into the base document would
      // restore the discarded-resolver invocation that nulls the org. The tests
      // above assert which document was REQUESTED, not what is in it.
      expect(APP_ORG_AGENTS_QUERY).toMatch(/\bagents\b/);
      expect(APP_ORG_AGENTS_QUERY).not.toMatch(/agentOrgGrants/);
      expect(APP_DETAIL_ORG_QUERY).not.toMatch(/\bagents\b/);
    });
  });

});

// portal#1068 — hadron-server#2080 makes App.keys manager-only and non-null. The
// App page must keep loading for a non-manager: the key inventory is its own
// classified read, so a refusal there is a state, not a 404.
describe('load: key inventory (portal#1068)', () => {
  const forbidden = { response: { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] } };
  async function loadWith(keysRead: () => Promise<unknown>) {
    mockFetchAllItems.mockResolvedValue([]);
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) {
        return Promise.resolve({
          app: {
            id: 'app-1', name: 'Demo App', urn: 'hadronmemory.com:demo-org:demo-app', organizationId: null,
            appType: 'CHATBOT', role: 'ADMIN', description: null, systemPrompt: null,
            createUserPermission: 'DENY', identifyUserMethod: 'USER_ID',
            sessionTimeoutSeconds: 3600, anonymousTtlDays: 14, agentId: null, agent: null,
          },
        });
      }
      if (query === APP_KEYS_QUERY) return keysRead();
      if (query === APP_MEMBERS_QUERY) return Promise.resolve({ app: { members: [] } });
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      if (query === TEAM_WORK_ITEMS_QUERY) return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0])) as { app: { id: string }; appKeys: unknown };
  }
  it('the App query selects no keys field', () => {
    expect(APP_QUERY).not.toMatch(/^\s*keys\s*\{/m);
  });
  it('a manager gets the keys', async () => {
    const r = await loadWith(() => Promise.resolve({ appKeys: [{ id: 'k1' }] }));
    expect(r.appKeys).toEqual({ kind: 'ok', keys: [{ id: 'k1' }] });
  });
  it('a non-manager still gets the App (no false 404) and a hidden inventory', async () => {
    const r = await loadWith(() => Promise.reject(forbidden));
    expect(r.app.id).toBe('app-1');
    expect(r.appKeys).toEqual({ kind: 'hidden' });
  });
  it('a failed read still loads the App, and is failed, not an empty list', async () => {
    const r = await loadWith(() => Promise.reject(new Error('boom')));
    expect(r.app.id).toBe('app-1');
    expect(r.appKeys).toEqual({ kind: 'failed' });
  });
});


describe('postChannelMessage (#1033)', () => {
  it('uses the selected Channel with the human token, keeps replies, and never sends a session', async () => {
    mockRequest.mockImplementation(async q => q === APP_CHAT_TARGET_QUERY
      ? { app: { id: 'app-1' } } : q === CHANNEL_CHAT_TARGET_QUERY ? { channel: { id: 'pair-channel', memory: { appId: 'app-1' } } }
      : { createChannelMessage: { seq: 20 } });
    const result = await runAction('postChannelMessage', { _kind: 'postTeamChatMessage', channelRef: 'pair-channel', body: 'hello', replyToSeq: '12', sessionRef: 'forged' });
    expect(result).toMatchObject({ form: { id: 'channel:pair-channel', message: { type: 'success' } } });
    expect(mockRequest).toHaveBeenLastCalledWith(CREATE_CHANNEL_MESSAGE_MUTATION, { channelRef: 'pair-channel', body: 'hello', replyToSeq: 12 });
  });
  it('keeps the failed draft and makes no mutation when the Channel belongs to another App', async () => {
    mockRequest.mockImplementation(async q => q === APP_CHAT_TARGET_QUERY ? { app: { id: 'app-1' } } : { channel: { id: 'pair-channel', memory: { appId: 'other' } } });
    const result = await runAction('postChannelMessage', { _kind: 'postTeamChatMessage', channelRef: 'pair-channel', body: 'kept draft' });
    expect(result).toMatchObject({ status: 500, data: { form: { data: { body: 'kept draft' }, message: { type: 'error' } } } });
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });
});

// portal#1148 (hadron-server#2089): the Human Team roster has three outcomes, and a withheld
// roster (members: null) is neither a failed fetch nor an empty one.
describe('load: Human Team roster states (portal#1148)', () => {
  async function loadMembers(membersRead: () => Promise<unknown>) {
    mockFetchAllItems.mockResolvedValue([]);
    mockRequest.mockImplementation((query) => {
      if (query === APP_QUERY) {
        return Promise.resolve({
          app: {
            id: 'app-1', name: 'Demo App', urn: 'hadronmemory.com:demo-org:demo-app', organizationId: null,
            appType: 'CHATBOT', role: 'ADMIN', description: null, systemPrompt: null,
            createUserPermission: 'DENY', identifyUserMethod: 'USER_ID',
            sessionTimeoutSeconds: 3600, anonymousTtlDays: 14, agentId: null, agent: null,
          },
        });
      }
      if (query === APP_MEMBERS_QUERY) return membersRead();
      if (query === APP_NODES_QUERY) return Promise.resolve({ appNodes: [] });
      if (query === TEAM_CHAT_MESSAGES_QUERY) return Promise.resolve({ teamChatMessages: { items: [], total: 0 } });
      if (query === TEAM_WORK_ITEMS_QUERY) return Promise.resolve({ teamWorkItems: { items: [], total: 0 } });
      return Promise.resolve({ resolveAiServiceConfigs: [] });
    });
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0])) as { members: unknown[]; membersError: boolean; membersWithheld: boolean };
  }
  it('members: null is withheld — not an error, not an empty roster', async () => {
    const r = await loadMembers(() => Promise.resolve({ app: { members: null } }));
    expect(r).toMatchObject({ members: [], membersError: false, membersWithheld: true });
  });
  it('known-empty control: members: [] is neither withheld nor an error', async () => {
    const r = await loadMembers(() => Promise.resolve({ app: { members: [] } }));
    expect(r).toMatchObject({ members: [], membersError: false, membersWithheld: false });
  });
  it('a failed fetch is an error, not withheld', async () => {
    const r = await loadMembers(() => Promise.reject(new Error('boom')));
    expect(r).toMatchObject({ members: [], membersError: true, membersWithheld: false });
  });
  it('real members come through', async () => {
    const r = await loadMembers(() => Promise.resolve({ app: { members: [{ userId: 'u1', appId: 'app-1', role: 'owner' }] } }));
    expect(r).toMatchObject({ membersError: false, membersWithheld: false });
    expect(r.members).toHaveLength(1);
  });
});
