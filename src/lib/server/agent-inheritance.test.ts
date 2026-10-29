import { describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
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

const refusal = (code: string) => new ClientError({ status: 200, body: '{}', headers: new Headers(), errors: [new GraphQLError('AGENT_NOT_FOUND: Agent secret-agent-id', { extensions: { code } })] }, { query: 'query Fixture { __typename }' });
describe('definition-list refusal copy', () => {
  it.each(['AGENT_NOT_FOUND', 'FORBIDDEN'])('presents %s without claiming the Agent exists or naming a required role', async code => {
    const request = vi.fn().mockResolvedValueOnce({ agent: { extendsAgentId: null } }).mockRejectedValueOnce(refusal(code)).mockRejectedValueOnce(refusal(code));
    const result = await loadAgentInheritance({ request } as never, 'secret-agent-id');
    expect(result.tasks).toEqual({ items: null, error: 'Tasks are unavailable. The Agent may be unavailable or you may not have access to its task list.' });
    expect(result.processes).toEqual({ items: null, error: 'Processes are unavailable. The Agent may be unavailable or you may not have access to its process list.' });
    expect(request).toHaveBeenCalledTimes(3);
  });
  it.each(['INTERNAL_SERVER_ERROR', 'NEW_UNKNOWN_CODE'])('keeps %s a failure instead of misclassifying it as a refusal or an empty list', async code => {
    const request = vi.fn().mockResolvedValueOnce({ agent: { extendsAgentId: null } }).mockRejectedValueOnce(refusal(code)).mockResolvedValueOnce({ agentProcessList: [] });
    const result = await loadAgentInheritance({ request } as never, 'child');
    expect(result.tasks).toEqual({ items: null, error: 'Something went wrong on our side.' });
    expect(result.processes).toEqual({ items: [], error: null });
  });
});

it('keeps a payload-less transport error as a failure', async () => {
  const error = new ClientError({ status: 502, body: 'Bad Gateway', headers: new Headers() }, { query: 'query Fixture { __typename }' });
  const request = vi.fn().mockResolvedValueOnce({ agent: { extendsAgentId: null } }).mockRejectedValueOnce(error).mockResolvedValueOnce({ agentProcessList: [] });
  const result = await loadAgentInheritance({ request } as never, 'child');
  expect(result.tasks.items).toBeNull();
  expect(result.tasks.error).toBe('Could not load definitions');
  expect(result.tasks.error).not.toContain('query Fixture');
});
