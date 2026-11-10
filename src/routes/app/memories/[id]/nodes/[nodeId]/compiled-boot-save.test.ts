import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
// portal#1899: the server refuses a generic edit of a compiled boot prompt with a typed
// BOOT_PROMPT_COMPILED_WRITE (only a compile writes it). The editor save must show the
// server's words as a 4xx rejection, never the generic 500 "Something went wrong".
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn() }));
const node = { id: 'node-1', memoryId: 'mem-1', loc: 'boot:compiled', name: 'Compiled', nodeType: 'compiled-boot-prompt', role: 'boot-prompt', isRunnable: false, data: {}, properties: {}, tags: [] };
beforeEach(() => { request.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
async function save(code: string, message: string) {
  request.mockImplementation(async (doc) => {
    if (doc === NODE_BY_ID_QUERY) return { node };
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
    expect(JSON.stringify((console.error as unknown as { mock: { calls: unknown[] } }).mock.calls)).not.toContain('private wire prose');
  });
});
