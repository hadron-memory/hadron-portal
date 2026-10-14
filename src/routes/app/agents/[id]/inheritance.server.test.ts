import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphQLError } from 'graphql';
import { ClientError } from 'graphql-request';
import { SET_AGENT_BASE_MUTATION, SET_AGENT_INDEX_REFS_MUTATION } from '$lib/server/agent-inheritance-write';
const request = vi.hoisted(() => vi.fn());
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { actions } from './+page.server';
beforeEach(() => { request.mockReset(); request.mockImplementation(async doc => doc === SET_AGENT_BASE_MUTATION ? { setAgentBase: { id: 'child' } } : { setAgentIndexRefs: { id: 'child' } }); });
function event(fields: Record<string, string>) {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return { request: new Request('http://test/app/agents/child', { method: 'POST', body }), params: { id: 'child' }, locals: { token: 'token' } } as never;
}
const indexes = { _kind: 'setAgentIndexRefs', tasksOperation: 'keep', tasksIndexRef: '', processesOperation: 'keep', processesIndexRef: '' };
describe('Agent inheritance actions', () => {
  it('sets and explicitly clears a base through the server', async () => {
    const result = await actions.setBase(event({ _kind: 'setAgentBase', operation: 'set', baseRef: 'hrn:agent:example.com:base' }));
    expect(result).toMatchObject({ form: { message: { type: 'success' } } });
    expect(request).toHaveBeenLastCalledWith(SET_AGENT_BASE_MUTATION, { ref: 'child', baseRef: 'hrn:agent:example.com:base' });
    await actions.setBase(event({ _kind: 'setAgentBase', operation: 'clear', baseRef: 'stale' }));
    expect(request).toHaveBeenLastCalledWith(SET_AGENT_BASE_MUTATION, { ref: 'child', baseRef: null });
  });
  it('rejects omitted base intent instead of allowing GraphQL omission to clear', async () => {
    const result = await actions.setBase(event({ _kind: 'setAgentBase', baseRef: '' }));
    expect(result).toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });
  it('sets one pointer while leaving the other omitted', async () => {
    await actions.setIndexRefs(event({ ...indexes, tasksOperation: 'set', tasksIndexRef: 'hrn:node:example.com:system:tasks' }));
    expect(request).toHaveBeenLastCalledWith(SET_AGENT_INDEX_REFS_MUTATION, { ref: 'child', tasksIndexRef: 'hrn:node:example.com:system:tasks' });
  });
  it('clears one pointer while keeping the other, including stale textbox values', async () => {
    await actions.setIndexRefs(event({ ...indexes, tasksIndexRef: 'stale', processesOperation: 'clear', processesIndexRef: 'stale' }));
    expect(request).toHaveBeenLastCalledWith(SET_AGENT_INDEX_REFS_MUTATION, { ref: 'child', processesIndexRef: null });
  });
  it('requires a value for set and rejects missing operation fields', async () => {
    expect(await actions.setIndexRefs(event({ ...indexes, tasksOperation: 'set' }))).toMatchObject({ status: 400 });
    const { processesOperation: ignored, ...missing } = indexes;
    expect(await actions.setIndexRefs(event(missing))).toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['AGENT_BASE_CYCLE', 'AGENT_BASE_CHAIN_TOO_LONG', 'AGENT_ORG_GRANT_REQUIRED', 'FORBIDDEN'])('preserves the server refusal %s', async code => {
    const text = `${code}: server wording`;
    request.mockRejectedValueOnce(new ClientError({ status: 200, body: '{}', headers: new Headers(), errors: [new GraphQLError(text, { extensions: { code } })] }, { query: 'mutation Fixture { __typename }' }));
    const result = await actions.setBase(event({ _kind: 'setAgentBase', operation: 'set', baseRef: 'hrn:agent:example.com:base' }));
    expect(result).toMatchObject({ status: 500, data: { form: { message: { type: 'error', text } } } });
  });
});
it('preserves an index-node refusal without changing the other pointer', async () => {
  request.mockRejectedValueOnce(new Error('NODE_NOT_FOUND: index unavailable'));
  const result = await actions.setIndexRefs(event({ ...indexes, processesOperation: 'set', processesIndexRef: 'hrn:node:example.com:system:processes' }));
  expect(result).toMatchObject({ status: 500, data: { form: { message: { text: 'NODE_NOT_FOUND: index unavailable' } } } });
  expect(request).toHaveBeenLastCalledWith(SET_AGENT_INDEX_REFS_MUTATION, { ref: 'child', processesIndexRef: 'hrn:node:example.com:system:processes' });
});
