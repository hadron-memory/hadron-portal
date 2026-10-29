/** Real graphql-request transport: request() discards extensions after our middleware sees them. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureNodeAdvice, nodeAdviceHandle, takeNodeAdvice } from './node-advice';
import { INCLUDE_PIN_UNKEPT, INCLUDE_PIN_UNKEPT_TEXT } from '$lib/node-advice';
vi.mock('$env/dynamic/private', () => ({ env: { LOCAL_SERVER_URL: 'https://server.test' } }));
import { gqlClient } from './api';
import { CREATE_AGENT_TASK_MUTATION } from './queries';

const NODE_ADVICE_CREATE_MUTATION = /* GraphQL */ `mutation NodeAdviceCreate($input: CreateNodeInput!) { saved: createNode(input: $input) { id } }`;
const NODE_ADVICE_UPDATE_MUTATION = /* GraphQL */ `mutation NodeAdviceUpdate($input: UpdateNodeInput!) { saved: updateNode(input: $input) { id } }`;
const NODE_ADVICE_TASK_MUTATION = /* GraphQL */ `mutation NodeAdviceTask($input: UpdateNodeInput!) { saved: updateTaskNode(input: $input) { id } }`;
const NODE_ADVICE_SPEC_MUTATION = /* GraphQL */ `mutation NodeAdviceSpec($input: UpdateNodeInput!) { saved: updateSpecNode(input: $input) { id } }`;
const NODE_ADVICE_REVIEW_MUTATION = /* GraphQL */ `mutation NodeAdviceReview($input: UpdateNodeInput!) { saved: updateReviewNode(input: $input) { id } }`;
const NODE_ADVICE_RESTORE_MUTATION = /* GraphQL */ `mutation NodeAdviceRestore($revisionId: ID!) { saved: restoreNodeRevision(revisionId: $revisionId) { id } }`;
const NODE_ADVICE_BULK_MUTATION = /* GraphQL */ `mutation NodeAdviceBulk($input: SearchReplaceInNodesInput!) { saved: searchReplaceInNodes(input: $input) { totalReplacements } }`;
afterEach(() => vi.unstubAllGlobals());

function requestEvent() {
  const jar = new Map<string, string>();
  const cookies = { get: (k: string) => jar.get(k), set: vi.fn((k: string, v: string) => { jar.set(k, v); }), delete: vi.fn((k: string) => { jar.delete(k); }), serialize: vi.fn((k: string, v: string) => `${k}=${v}; Path=/app`) };
  return { request: new Request('https://portal.test/app/save', { method: 'POST' }), url: new URL('https://portal.test/app/save'), locals: { user: { id: 'writer' } }, cookies };
}

describe('shared node advice transport', () => {
  it.each([
    ['create', NODE_ADVICE_CREATE_MUTATION], ['update', NODE_ADVICE_UPDATE_MUTATION], ['task', NODE_ADVICE_TASK_MUTATION], ['spec', NODE_ADVICE_SPEC_MUTATION], ['review', NODE_ADVICE_REVIEW_MUTATION], ['restore', NODE_ADVICE_RESTORE_MUTATION], ['bulk', NODE_ADVICE_BULK_MUTATION],
  ])('keeps %s advice without changing the data or replaying the write', async (operation, document) => {
    const data = { saved: operation === 'bulk' ? { totalReplacements: 3 } : { id: 'n' } };
    const variables: Record<string, unknown> = operation === 'restore' ? { revisionId: 'revision' }
      : operation === 'bulk' ? { input: { nodeIds: ['n'], fields: ['content'], oldText: 'before', newText: 'after' } }
      : { input: { memoryId: 'm', loc: 'n', name: 'N' } };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data, extensions: { warnings: [{ path: 'saved', code: INCLUDE_PIN_UNKEPT, text: INCLUDE_PIN_UNKEPT_TEXT }] } }), { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const e = requestEvent();
    const result = await nodeAdviceHandle({ event: e, resolve: async () => {
      expect(await gqlClient('token').request(document, variables)).toEqual(data);
      return new Response(null, { status: 200 });
    } } as never);
    expect(result.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.headers.get('set-cookie')).toContain('hadron_node_advice_writer=1');
  });
  it('a refused write retains its error and does not deliver advice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { saved: null }, errors: [{ message: 'refused', path: ['saved'] }], extensions: { warnings: [{ path: 'saved', code: INCLUDE_PIN_UNKEPT, text: INCLUDE_PIN_UNKEPT_TEXT }] } }), { headers: { 'content-type': 'application/json' } })));
    const e = requestEvent();
    await nodeAdviceHandle({ event: e, resolve: async () => {
      await expect(gqlClient('token').request(NODE_ADVICE_UPDATE_MUTATION, { input: { id: 'n', content: 'edit' } })).rejects.toThrow('refused');
      return new Response(null, { status: 400 });
    } } as never);
    expect(e.cookies.set).not.toHaveBeenCalled();
  });
  it('task warning transport remains unchanged and produces no node advice', async () => {
    const warning = { path: 'createAgentTask', code: 'task.create.no-source', text: 'Link a source' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { createAgentTask: { id: 't' } }, extensions: { warnings: [warning] } }), { headers: { 'content-type': 'application/json' } })));
    const e = requestEvent();
    await nodeAdviceHandle({ event: e, resolve: async () => {
      expect((await gqlClient('token').rawRequest(CREATE_AGENT_TASK_MUTATION, { input: { appRef: 'app', title: 'Task' } })).extensions).toEqual({ warnings: [warning] });
      return new Response(null);
    } } as never);
    expect(e.cookies.set).not.toHaveBeenCalled();
  });
  it('without a request scope, optional advice capture does nothing', () => {
    expect(() => captureNodeAdvice({ data: { n: {} }, extensions: { warnings: [] } })).not.toThrow();
  });
});
