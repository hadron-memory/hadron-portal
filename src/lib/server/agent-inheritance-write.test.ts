import { beforeEach, describe, expect, it, vi } from 'vitest';
import { baseVariables, indexVariables, loadInheritanceManagement, SELF_AGENT_MANAGE_QUERY } from './agent-inheritance-write';
describe('Agent inheritance writes', () => {
  it('makes clearing the base explicit', () => {
    expect(baseVariables('child', { operation: 'clear', baseRef: 'stale' })).toEqual({ ref: 'child', baseRef: null });
    expect(baseVariables('child', { operation: 'set', baseRef: 'hrn:agent:example.com:base' })).toEqual({ ref: 'child', baseRef: 'hrn:agent:example.com:base' });
  });
  it('preserves the three index states independently', () => {
    expect(indexVariables('child', { tasksOperation: 'keep', tasksIndexRef: 'stale', processesOperation: 'clear', processesIndexRef: 'stale' })).toEqual({ ref: 'child', processesIndexRef: null });
    expect(indexVariables('child', { tasksOperation: 'set', tasksIndexRef: 'hrn:node:example.com:system:tasks', processesOperation: 'keep', processesIndexRef: '' })).toEqual({ ref: 'child', tasksIndexRef: 'hrn:node:example.com:system:tasks' });
  });
  it('uses the server manager answer, retaining current pointer ids', async () => {
    const request = vi.fn().mockResolvedValueOnce({ effectiveAccess: { canManage: true } }).mockResolvedValueOnce({ agent: { extendsAgentId: null, tasksIndexRef: 'tasks-id', processesIndexRef: null } }).mockResolvedValueOnce({ node: { name: 'Tasks', urn: 'hrn:node:example.com:system:tasks' } });
    const result = await loadInheritanceManagement({ request } as never, 'child', 'hrn:agent:example.com:child', 'me', false);
    expect(result.canManage).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, SELF_AGENT_MANAGE_QUERY, { user: 'me', resource: 'hrn:agent:example.com:child' });
    expect(result.refs?.tasksIndexRef).toBe('tasks-id');
  });
  it('does not fetch manager-only settings for a non-manager', async () => {
    const request = vi.fn().mockResolvedValueOnce({ effectiveAccess: { canManage: false } });
    expect((await loadInheritanceManagement({ request } as never, 'child', 'hrn:agent:example.com:child', 'me', false)).canManage).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not turn an outage into a valid no-permission answer', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline'));
    const result = await loadInheritanceManagement({ request } as never, 'child', 'hrn:agent:example.com:child', 'me', false);
    expect(result.error).toBe('offline');
    expect(result.canManage).toBe(false);
  });
});

it('hides impersonated writes without issuing a permission query', async () => {
  const request = vi.fn();
  const result = await loadInheritanceManagement({ request } as never, 'child', 'hrn:agent:example.com:child', 'me', true);
  expect(result.canManage).toBe(false);
  expect(request).not.toHaveBeenCalled();
});
it('keeps manager controls available when an index identity cannot render', async () => {
  const request = vi.fn().mockResolvedValueOnce({ effectiveAccess: { canManage: true } }).mockResolvedValueOnce({ agent: { extendsAgentId: null, tasksIndexRef: 'tasks-id', processesIndexRef: null } }).mockRejectedValueOnce(new Error('Template compile failed'));
  const result = await loadInheritanceManagement({ request } as never, 'child', 'hrn:agent:example.com:child', 'me', false);
  expect(result.canManage).toBe(true);
  expect(result.error).toBeNull();
  expect(result.tasksNode).toBeNull();
  expect(result.refs?.tasksIndexRef).toBe('tasks-id');
});
const fetchOwnedAgents = vi.fn();
vi.mock('$lib/server/personal-agents', () => ({ fetchOwnedAgents: (...a: unknown[]) => fetchOwnedAgents(...a) }));
import { loadBaseCandidates } from './agent-inheritance-write';
import { APP_ORG_AGENTS_QUERY, APP_ORG_AGENT_GRANTS_QUERY } from './queries';
describe('Parent-agent picker candidates', () => {
  const self = { id: 'child', name: 'Child', urn: 'hrn:agent:example.com:child' };
  beforeEach(() => { fetchOwnedAgents.mockReset(); });
  it('offers the organization agents for an org agent, minus itself', async () => {
    const request = vi.fn().mockResolvedValue({ organization: { agents: [self, { id: 'org-b', name: 'Org Peer', urn: 'hrn:agent:example.com:org-b' }] } });
    const result = await loadBaseCandidates({ request } as never, 'token', 'org-1', 'child');
    expect(request).toHaveBeenCalledWith(APP_ORG_AGENTS_QUERY, { ref: 'org-1' });
    expect(result?.map((a) => a.id)).toEqual(['org-b']);
  });
  it('offers the caller-owned agents for a personal agent, minus itself', async () => {
    const request = vi.fn();
    fetchOwnedAgents.mockResolvedValueOnce([self, { id: 'own-b', name: 'Own Peer', urn: 'hrn:agent:example.com:own-b' }]);
    const result = await loadBaseCandidates({ request } as never, 'token', null, 'child');
    expect(request).not.toHaveBeenCalled();
    expect(result?.map((a) => a.id)).toEqual(['own-b']);
  });
  it('returns null — not an empty list — when the candidate read fails', async () => {
    const request = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(loadBaseCandidates({ request } as never, 'token', 'org-1', 'child')).resolves.toBeNull();
    fetchOwnedAgents.mockRejectedValueOnce(new Error('offline'));
    await expect(loadBaseCandidates({ request } as never, 'token', null, 'child')).resolves.toBeNull();
  });
});

describe('#1278 licensed and subscribed parent candidates', () => {
  const agent = (id: string) => ({ id, name: id, urn: `hrn:agent:example.com:${id}` });
  const grant = (id: string, over = {}) => ({ isActive: true, revokedAt: null, expiresAt: null, agent: agent(id), ...over });
  const client = (grants: unknown[], failGrants = false) => ({ request: vi.fn(async (query: string) => {
    if (query === APP_ORG_AGENTS_QUERY) return { organization: { agents: [agent('child'), agent('owned')] } };
    if (query === APP_ORG_AGENT_GRANTS_QUERY) {
      if (failGrants) throw new Error('grants unavailable');
      return { organization: { agentOrgGrants: grants } };
    }
    throw new Error('unexpected query');
  }) });
  it('adds active licensed cross-org and subscribed PUBLIC agents, dedupes and excludes self', async () => {
    const c = client([grant('licensed'), grant('public'), grant('licensed'), grant('owned'), grant('child')]);
    expect((await loadBaseCandidates(c as never, 'token', 'org-1', 'child'))?.map(a => a.id)).toEqual(['owned', 'licensed', 'public']);
    expect(c.request).toHaveBeenCalledWith(APP_ORG_AGENT_GRANTS_QUERY, { ref: 'org-1' });
  });
  it('does not offer inactive, revoked, expired or unreadable grants', async () => {
    const c = client([grant('inactive', { isActive: false }), grant('revoked', { revokedAt: '2020-01-01T00:00:00Z' }), grant('expired', { expiresAt: '2020-01-01T00:00:00Z' }), grant('hidden', { agent: null }), grant('live', { expiresAt: '2099-01-01T00:00:00Z' })]);
    expect((await loadBaseCandidates(c as never, 'token', 'org-1', 'child'))?.map(a => a.id)).toEqual(['owned', 'live']);
  });
  it('a failed grant read leaves owned candidates available', async () => {
    expect((await loadBaseCandidates(client([], true) as never, 'token', 'org-1', 'child'))?.map(a => a.id)).toEqual(['owned']);
  });
});
