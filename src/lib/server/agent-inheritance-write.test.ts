import { describe, expect, it, vi } from 'vitest';
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
