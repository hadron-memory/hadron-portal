import { describe, expect, it, vi } from 'vitest';
import { loadAgentInheritance } from './agent-inheritance';

describe('Agent inheritance reads', () => {
  it('keeps server entries and provenance without a client union', async () => {
    const rows = [{ node: { id: 'base-task', memoryId: 'base-memory', name: 'Ship', loc: 'ship', urn: 'hrn:node:test:base:ship', inheritedFrom: { agentId: 'base', agentUrn: 'hrn:agent:test:base' } }, trigger: 'ready' }];
    const request = vi.fn().mockResolvedValueOnce({ agent: { extendsAgentId: 'base' } }).mockResolvedValueOnce({ agentTaskList: rows }).mockResolvedValueOnce({ agentProcessList: [] }).mockResolvedValueOnce({ agent: { id: 'base', name: 'Engineer', urn: 'hrn:agent:test:base' } });
    const result = await loadAgentInheritance({ request } as never, 'child');
    expect(result.tasks.items).toBe(rows);
    expect(result.base.agent?.name).toBe('Engineer');
    expect(result.processes.items).toEqual([]);
  });
  it('reports a disappeared Agent rather than claiming it has no base', async () => {
    const request = vi.fn().mockResolvedValueOnce({ agent: null }).mockResolvedValueOnce({ agentTaskList: [] }).mockResolvedValueOnce({ agentProcessList: [] });
    const result = await loadAgentInheritance({ request } as never, 'child');
    expect(result.base.error).toBe('Agent details are unavailable.');
  });
  it('distinguishes a refusal from an empty list and preserves its text', async () => {
    const request = vi.fn().mockResolvedValueOnce({ agent: { extendsAgentId: null } }).mockRejectedValueOnce(new Error('Upstream unavailable')).mockResolvedValueOnce({ agentProcessList: [] });
    const result = await loadAgentInheritance({ request } as never, 'child');
    expect(result.tasks.items).toBeNull();
    expect(result.tasks.error).toBe('Upstream unavailable');
    expect(result.processes.error).toBeNull();
  });
});
