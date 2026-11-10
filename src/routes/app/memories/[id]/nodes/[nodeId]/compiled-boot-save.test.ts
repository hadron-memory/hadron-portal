import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
// portal#1899: the server refuses a generic edit of a compiled boot prompt with a typed
// BOOT_PROMPT_COMPILED_WRITE (only a compile writes it). The editor save must show the
// fixed code as a 4xx rejection (the page words it; no server text is forwarded), never the generic 500.
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn() }));
const node = { id: 'node-1', memoryId: 'mem-1', loc: 'boot:compiled', name: 'Compiled', nodeType: 'compiled-boot-prompt', role: 'boot-prompt', isRunnable: false, data: {}, properties: {}, tags: [] };
beforeEach(() => { request.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}).mockClear(); });
async function save(code: string, message: string, plain?: 'read' | 'write') {
  request.mockImplementation(async (doc) => {
    if (doc === NODE_BY_ID_QUERY) { if (plain === 'read') throw new Error('private plain read error'); return { node }; }
    if (plain === 'write') throw new Error('private plain write error');
    throw new ClientError({ status: 200, headers: new Headers(), body: '', errors: [new GraphQLError(message, { extensions: { code } })] }, { query: 'mutation q', variables: {} });
  });
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('content', 'x!'); fd.set('expectedRevision', '5');
  return (await (actions as Record<string, (e: never) => Promise<unknown>>).updateContent({ request: { formData: async () => fd }, params: { id: 'mem-1', nodeId: 'node-1' }, locals: { token: 'test' } } as never)) as { status: number; data: { contentFailed: { code: string; detail: string } } };
}
describe('portal#1899 compiled boot prompt save', () => {
  it.each([
    ['BOOT_PROMPT_COMPILED_WRITE', 'compiled-prompt'],
    ['BOOT_PROMPT_WORKER_SESSION_REFUSED', 'boot-prompt-governed'],
  ])('%s is a 400 with a fixed code and no server text', async (code, fixed) => {
    const r = await save(code, `${code}: private wire prose`);
    expect(r.status).toBe(400);
    expect(r.data.contentFailed).toEqual({ code: fixed, detail: null });
  });
  it('an unclassified failure stays a 500 and logs only the code', async () => {
    const r = await save('SOMETHING_NEW', 'private wire prose');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r)).not.toContain('private wire prose');
    expect(r.data.contentFailed.detail).toBe('Something went wrong on our side.');
    // The log shape is pinned: exactly operation, stage and code, so no content or wire text can ride along.
    expect((console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls).toEqual([['[node-detail] save failed:', { op: 'update-content', stage: 'write', code: 'SOMETHING_NEW' }]]);
  });
  it.each(['read', 'write'] as const)('a plain %s Error never reaches the response; the log is bounded', async (stage) => {
    const r = await save('X', 'x', stage);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r)).not.toContain('private plain');
    const calls = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toEqual([['[node-detail] save failed:', { op: 'update-content', stage, code: 'no-code' }]]);
  });
  it('an out-of-shape wire code is logged as a fixed marker, never as itself', async () => {
    const r = await save('some wire prose with content', 'private wire prose');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r)).not.toContain('private wire prose');
    expect(JSON.stringify(r)).not.toContain('some wire prose with content');
    const calls = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toEqual([['[node-detail] save failed:', { op: 'update-content', stage: 'write', code: 'unrecognized' }]]);
  });
  it('a GraphQL error with no code shows the generic copy, never its message', async () => {
    const r = await save('', 'private wire prose');
    expect(r.status).toBe(500);
    expect(JSON.stringify(r)).not.toContain('private wire prose');
    expect(r.data.contentFailed.detail).toBe('Something went wrong on our side.');
    const calls = (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(calls).toEqual([['[node-detail] save failed:', { op: 'update-content', stage: 'write', code: 'no-code' }]]);
  });
});
