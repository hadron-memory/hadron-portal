import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { jsonFingerprint } from '$lib/properties-source';
import { NODE_BY_ID_QUERY, NODE_DATA_READ_QUERY, NODE_PROPERTIES_READ_QUERY, NODE_QUERY } from '$lib/server/queries';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn() }));
const node = { id: 'node-1', memoryId: 'mem-1', loc: 'note', name: 'Note', nodeType: 'info', role: null, isRunnable: false, data: {}, properties: {}, tags: [] };
const refusals = [
  [{ code: 'ROLE_NOT_DECLARED', role: 'review.special', strictParent: 'review' }, /review.special.*review.*declared sub-role.*manager/i],
  [{ code: 'ROLE_WRITER_LEVEL_REQUIRED', role: 'review', ruleRole: 'task', level: 'ADMIN', side: 'before' }, /rule.*task.*owning organization.*admins.*owners.*owning user.*memory write access.*changing or clearing/i],
  [{ code: 'ROLE_WRITERS_UNSUPPORTED', role: 'review', ruleRole: 'task', level: 'OWNER' }, /task.*OWNER.*not supported.*no one.*manages.*configuration/i],
  [{ code: 'ROLE_GOVERNED', kind: 'task', op: 'update', door: 'updateTaskNode', mcpDoor: null }, /original governed reason.*update a runnable node/i],
] as const;
const payloads = [
  ['updateContent', { content: 'kept draft', expectedRevision: '3' }],
  ['updateAbstract', { abstract: 'kept draft', expectedRevision: '3' }],
  ['updateData', { data: '{"draft":true}', baseline: await jsonFingerprint({}) }],
  ['updateProperties', { properties: '{"draft":true}', baseline: await jsonFingerprint({}) }],
  ['updateStorage', { _kind: 'updateStorage', objectType: '', propertiesJson: '{"draft":true}' }],
  ['updateMeta', { name: 'Kept name', loc: 'note', nodeType: 'info', description: 'kept draft', tags: '', seq: '1', alias: '' }],
] as const;
beforeEach(() => { request.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
async function run(action: string, payload: Record<string, string>, extensions: Record<string, unknown>) {
  request.mockImplementation(async (doc) => {
    if ([NODE_BY_ID_QUERY, NODE_DATA_READ_QUERY, NODE_PROPERTIES_READ_QUERY, NODE_QUERY].includes(doc)) return { node };
    throw new ClientError({ status: 200, headers: new Headers(), body: '', errors: [new GraphQLError(extensions.code === 'ROLE_GOVERNED' ? 'original governed reason' : 'private wire prose', { extensions })] }, { query: 'mutation privateQuery', variables: { secret: 'private variable' } });
  });
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k,v] of Object.entries(payload)) fd.set(k,v);
  const result = await (actions as Record<string, (e: never) => Promise<unknown>>)[action]({ request: { formData: async () => fd }, params: { id: 'mem-1', nodeId: 'node-1' }, locals: { token: 'test' } } as never);
  expect(request.mock.calls.length).toBeGreaterThan(1);
  return JSON.stringify(result);
}
describe.each(payloads)('%s role refusal recovery', (action, payload) => {
  it.each(refusals)('maps structured %j', async (extensions, copy) => {
    const output = await run(action, payload, extensions);
    expect(output).toMatch(copy);
    expect(output).not.toContain('private wire prose');
    expect(output).not.toContain('private variable');
  });
  it.each(['INTERNAL_SERVER_ERROR', 'UNKNOWN_NEW_CODE'])('keeps safe %s fallback', async code => {
    const output = await run(action, payload, { code, requestId: '12345678-1234-4123-8123-123456789abc' });
    expect(output).toContain('Something went wrong on our side.');
    expect(output).not.toContain('private wire prose');
    if (code === 'INTERNAL_SERVER_ERROR') expect(output).toContain('12345678-1234-4123-8123-123456789abc');
  });
});
