/**
 * #1786 (hadron-server#3626, ruling 0235): the personal App's Add Agent picker
 * offers the ORGANIZATION-visible Agents of the caller's member organizations
 * beside their own and PUBLIC ones — the same eligible set as /app/apps/new.
 * Documents are matched by content so these pins are red on a main without them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_QUERY, APP_MEMBERS_QUERY, APP_NODES_QUERY, TEAM_CHAT_MESSAGES_QUERY, TEAM_WORK_ITEMS_QUERY,
  MY_AGENTS_QUERY, PUBLIC_AGENTS_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
const mockFetchAllItems = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: mockFetchAllItems }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

type Agent = { id: string; name: string; urn: string };
const OWN: Agent = { id: 'a-own', name: 'Own', urn: 'hrn:agent:holger:own' };
const PUB: Agent = { id: 'a-pub', name: 'Pub', urn: 'hrn:agent:acme.com:pub' };
const ORG: Agent = { id: 'a-org', name: 'Org', urn: 'hrn:agent:acme.com:org' };
const isMemberOrgsDoc = (doc: string) => /organizations\s*\(\s*filter:\s*\{\s*memberOnly:\s*true\s*\}/.test(doc);
const isOrgAgentsDoc = (doc: string) => /agents\s*\(\s*filter:\s*\{\s*visibility:\s*ORGANIZATION\s*\}/.test(doc);

const app = {
  id: 'app-1', name: 'Mine', urn: 'holger:mine', organizationId: null, appType: 'WORKSTATION', role: 'OWNER',
  description: null, systemPrompt: null, createUserPermission: 'DENY', identifyUserMethod: 'USER_ID',
  sessionTimeoutSeconds: 3600, anonymousTtlDays: 14, agentId: null, agent: null,
};

function route(opts: { orgs?: string[] | Error; orgAgents?: Record<string, Agent[] | Error> }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === APP_QUERY) return { app };
    if (query === APP_MEMBERS_QUERY) return { app: { members: [] } };
    if (query === APP_NODES_QUERY) return { appNodes: [] };
    if (query === TEAM_CHAT_MESSAGES_QUERY) return { teamChatMessages: { items: [], total: 0 } };
    if (query === TEAM_WORK_ITEMS_QUERY) return { teamWorkItems: { items: [], total: 0 } };
    return { resolveAiServiceConfigs: [] };
  });
  mockFetchAllItems.mockImplementation(async (_client: unknown, doc: string, _key: string, vars?: { orgId?: string }) => {
    if (doc === MY_AGENTS_QUERY) return [OWN];
    if (doc === PUBLIC_AGENTS_QUERY) return [PUB];
    if (isMemberOrgsDoc(doc)) {
      if (opts.orgs instanceof Error) throw opts.orgs;
      return (opts.orgs ?? []).map((id) => ({ id }));
    }
    if (isOrgAgentsDoc(doc)) {
      const hit = opts.orgAgents?.[vars?.orgId ?? ''];
      if (hit instanceof Error) throw hit;
      return hit ?? [];
    }
    return [];
  });
}

async function runLoad() {
  const { load } = await import('./+page.server');
  return (await load({
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'user-1' } },
    parent: async () => ({}),
    depends: () => {},
    url: new URL('http://localhost/app/apps/app-1?tab=agents'),
  } as unknown as Parameters<typeof load>[0])) as { availableAgents: Agent[]; availableAgentsError: boolean };
}

beforeEach(() => { mockRequest.mockReset(); mockFetchAllItems.mockReset(); });

describe('#1786 personal App Add Agent picker', () => {
  it('offers a member org’s ORGANIZATION-visible Agent after own and PUBLIC, scoped by orgId', async () => {
    route({ orgs: ['org-1'], orgAgents: { 'org-1': [ORG, PUB] } });
    const r = await runLoad();
    expect(r.availableAgents.map((a) => a.id)).toEqual(['a-own', 'a-pub', 'a-org']);
    expect(r.availableAgentsError).toBe(false);
    const orgCalls = mockFetchAllItems.mock.calls.filter(([, doc]) => isOrgAgentsDoc(doc as string));
    expect(orgCalls.map(([, , , vars]) => (vars as { orgId?: string }).orgId)).toEqual(['org-1']);
  });

  it('a non-member is offered no org Agent and no org-Agent list is asked for', async () => {
    route({ orgs: [], orgAgents: { 'org-1': [ORG] } });
    const r = await runLoad();
    expect(r.availableAgents.map((a) => a.id)).toEqual(['a-own', 'a-pub']);
    expect(mockFetchAllItems.mock.calls.some(([, doc]) => isMemberOrgsDoc(doc as string))).toBe(true);
    expect(mockFetchAllItems.mock.calls.some(([, doc]) => isOrgAgentsDoc(doc as string))).toBe(false);
  });

  it('a failed org lookup flags availableAgentsError and keeps own and PUBLIC', async () => {
    route({ orgs: ['org-1'], orgAgents: { 'org-1': new Error('boom') } });
    const r = await runLoad();
    expect(r.availableAgentsError).toBe(true);
    expect(r.availableAgents.map((a) => a.id)).toEqual(['a-own', 'a-pub']);
  });
});
