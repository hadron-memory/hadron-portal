import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_DEFINITION_QUERY } from '$lib/server/agent-inheritance';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { load } from './+page.server';
const event = { params: { id: 'child', loc: 'tasks:ship' }, locals: { token: 'token' } } as never;
beforeEach(() => { request.mockReset(); });
describe('child Agent node view', () => {
  it('reads a bare loc scoped to child memory, preserving base identity', async () => {
    const agent = { id: 'child', systemMemoryId: 'child-memory', name: 'Child', urn: 'hrn:agent:test:child' };
    const node = { id: 'base-node', loc: 'tasks:ship', name: 'Ship', content: 'Ready', urn: 'hrn:node:test:base:tasks:ship', inheritedFrom: { agentId: 'base', agentUrn: 'hrn:agent:test:base' } };
    request.mockResolvedValueOnce({ agent }).mockResolvedValueOnce({ node });
    expect(await load(event)).toEqual({ agent, node });
    expect(request).toHaveBeenLastCalledWith(AGENT_DEFINITION_QUERY, { ref: 'tasks:ship', memoryRef: 'child-memory' });
  });
  it('keeps denied and missing nodes indistinguishable', async () => {
    request.mockResolvedValueOnce({ agent: { id: 'child', name: 'Child', urn: 'hrn:agent:test:child', systemMemoryId: 'child-memory' } }).mockResolvedValueOnce({ node: null });
    await expect(load(event)).rejects.toMatchObject({ status: 404 });
  });
  it('does not turn a transport failure into not found', async () => {
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(load(event)).rejects.toThrow('offline');
  });
});
