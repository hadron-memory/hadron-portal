import { GraphQLError } from 'graphql';
import { ClientError } from 'graphql-request';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_DEFINITION_QUERY } from '$lib/server/agent-inheritance';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { load } from './+page.server';
const event = { params: { id: 'child', loc: 'tasks:ship' }, locals: { token: 'token' }, url: new URL('http://test/app/agents/child/definitions/tasks%3Aship?view=source') } as never;
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
    await expect(load(event)).rejects.toMatchObject({ status: 404, body: { message: 'Node not found' } });
  });
  it('does not turn a transport failure into not found', async () => {
    request.mockRejectedValueOnce(new Error('offline'));
    await expect(load(event)).rejects.toThrow('offline');
  });
});

function refusal(code?: string) {
  return new ClientError({ status: 200, body: '{}', headers: new Headers(), ...(code ? { errors: [new GraphQLError('refused', { extensions: { code } })] } : {}) }, { query: 'query Fixture { __typename }' });
}
it.each(['FORBIDDEN', 'PERMISSION_DENIED', 'AGENT_NOT_FOUND'])('conceals the Agent refusal %s', async code => {
  request.mockRejectedValueOnce(refusal(code));
  await expect(load(event)).rejects.toMatchObject({ status: 404, body: { message: 'Node not found' } });
});
it('conceals an unreadable child system memory', async () => {
  request.mockResolvedValueOnce({ agent: { id: 'child', name: 'Child', urn: 'hrn:agent:test:child', systemMemoryId: 'child-memory' } }).mockRejectedValueOnce(refusal('MEMORY_NOT_FOUND'));
  await expect(load(event)).rejects.toMatchObject({ status: 404, body: { message: 'Node not found' } });
});
it.each(['INTERNAL_SERVER_ERROR', 'NEW_UNKNOWN_CODE', undefined])('propagates an unmapped or payload-less failure %s', async code => {
  const err = refusal(code);
  request.mockRejectedValueOnce(err);
  await expect(load(event)).rejects.toBe(err);
});
it.each(['UNAUTHENTICATED', 'SESSION_EXPIRED'])('redirects an expired login %s', async code => {
  request.mockRejectedValueOnce(refusal(code));
  await expect(load(event)).rejects.toMatchObject({ status: 303, location: '/signin?redirect=%2Fapp%2Fagents%2Fchild%2Fdefinitions%2Ftasks%253Aship%3Fview%3Dsource' });
});

it('gives a missing Agent the same response as a denied Agent', async () => {
  request.mockResolvedValueOnce({ agent: null });
  await expect(load(event)).rejects.toMatchObject({ status: 404, body: { message: 'Node not found' } });
});
it('exports only the SvelteKit page-server API (the build validates this too)', async () => {
  const allowed = new Set(['load', 'actions', 'prerender', 'csr', 'ssr', 'trailingSlash', 'config', 'entries']);
  const route = await import('./+page.server');
  expect(Object.keys(route).filter(name => !name.startsWith('_') && !allowed.has(name))).toEqual([]);
});
