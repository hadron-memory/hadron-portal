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
import { APP_ORG_AGENTS_QUERY } from './queries';
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
