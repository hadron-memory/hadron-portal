import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
// portal#1899: the server refuses a generic edit of a compiled boot prompt with a typed
// BOOT_PROMPT_COMPILED_WRITE (only a compile writes it). The editor save must show the
// fixed code as a 4xx rejection (the page words it; no server text is forwarded), never the generic 500.
// Main 88c9764c: boundedLogCode checks falsy before code shape; saveFailureDetail and
// the write-error path keep unclassified responses generic. Hosted CI at aa2d2a0b passed.
// https://github.com/hadron-memory/hadron-portal/blob/88c9764c64aca3b5e0320b0a307205fe1d139535/src/routes/app/memories/%5Bid%5D/nodes/%5BnodeId%5D/%2Bpage.server.ts#L675-L682
// https://github.com/hadron-memory/hadron-portal/actions/runs/44871227361
//
// portal#2405: the fixtures vary two independent things, and the helper names both. WHERE the
// save fails is the `stage` (the node read that precedes the write, or the write itself). WHAT it
// fails with is the `wire` (a plain Error whose message can carry anything, or a GraphQL error
// with whatever `extensions` the server sent). A stage-specific behaviour is then never confused
// with an error-kind behaviour.
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn() }));
const node = { id: 'node-1', memoryId: 'mem-1', loc: 'boot:compiled', name: 'Compiled', nodeType: 'compiled-boot-prompt', role: 'boot-prompt', isRunnable: false, data: {}, properties: {}, tags: [] };
beforeEach(() => { request.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });

type Stage = 'read' | 'write';
/** What the failing request throws: a plain Error (never a GraphQL response), or a GraphQL error with these extensions. */
type Wire = { plain: string } | { message: string; extensions?: Record<string, unknown> };
/** The common GraphQL case: a server error carrying `code` (omit it for an error with empty extensions). */
const withCode = (code: string | undefined, message: string): Wire => ({ message, extensions: code === undefined ? {} : { code } });
type SaveResult = { status: number; data: { contentFailed: { code: string; detail: string | null } } };

async function save(stage: Stage, wire: Wire) {
  const failure = () => 'plain' in wire
    ? new Error(wire.plain)
    : new ClientError({ status: 200, headers: new Headers(), body: '', errors: [new GraphQLError(wire.message, { extensions: wire.extensions ?? {} })] }, { query: 'mutation q', variables: {} });
  request.mockImplementation(async (doc) => {
    if (doc === NODE_BY_ID_QUERY) { if (stage === 'read') throw failure(); return { node }; }
    throw failure(); // the one other request the action makes is the write
  });
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  fd.set('content', 'x!'); fd.set('expectedRevision', '5');
  return (await (actions as Record<string, (e: never) => Promise<unknown>>).updateContent({ request: { formData: async () => fd }, params: { id: 'mem-1', nodeId: 'node-1' }, locals: { token: 'test' } } as never)) as SaveResult;
}

const GENERIC_FAILURE = { contentFailed: { code: 'failed', detail: 'Something went wrong on our side.' } };
/** What the log carries: exactly the operation, the stage and a bounded code, so no content or wire text can ride along. */
const savedFailureLog = (stage: Stage, code: string) => [['[node-detail] save failed:', { op: 'update-content', stage, code }]];
/** The read stage short-circuits (one request, the read); the write stage reads first, then writes once. */
const expectRequests = (stage: Stage) => {
  expect(request).toHaveBeenCalledTimes(stage === 'read' ? 1 : 2);
  expect(request.mock.calls[0][0]).toBe(NODE_BY_ID_QUERY);
};
const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;
const expectNoneOf = (r: unknown, ...secrets: string[]) => { for (const s of secrets) expect(JSON.stringify(r)).not.toContain(s); };

describe('portal#1899 compiled boot prompt save', () => {
  it.each([
    ['BOOT_PROMPT_COMPILED_WRITE', 'compiled-prompt'],
    ['BOOT_PROMPT_WORKER_SESSION_REFUSED', 'boot-prompt-governed'],
  ])('%s is a 400 with a fixed code and no server text', async (code, fixed) => {
    const r = await save('write', withCode(code, `${code}: private wire prose`));
    expect(r.status).toBe(400);
    expect(r.data.contentFailed).toEqual({ code: fixed, detail: null });
  });
  it('an unclassified failure stays a 500 and logs only the code', async () => {
    const r = await save('write', withCode('SOMETHING_NEW', 'private wire prose'));
    expect(r.status).toBe(500);
    expectNoneOf(r, 'private wire prose');
    expect(r.data).toEqual(GENERIC_FAILURE);
    expect(logged()).toEqual(savedFailureLog('write', 'SOMETHING_NEW'));
    expectRequests('write');
  });
  it.each(['read', 'write'] as const)('a plain %s Error never reaches the response; the log is bounded', async (stage) => {
    const r = await save(stage, { plain: 'private plain error' });
    expect(r.status).toBe(500);
    expectNoneOf(r, 'private plain');
    expect(logged()).toEqual(savedFailureLog(stage, 'no-code'));
    expectRequests(stage);
  });
  it('an out-of-shape wire code is logged as a fixed marker, never as itself', async () => {
    const r = await save('write', withCode('some wire prose with content', 'private wire prose'));
    expect(r.status).toBe(500);
    expectNoneOf(r, 'private wire prose', 'some wire prose with content');
    expect(r.data).toEqual(GENERIC_FAILURE);
    expect(logged()).toEqual(savedFailureLog('write', 'unrecognized'));
    expectRequests('write');
  });
  it.each([['omitted', undefined], ['empty', '']] as const)('a GraphQL error with %s code shows the generic copy, never its message', async (_label, code) => {
    const r = await save('write', withCode(code, 'private wire prose'));
    expect(r.status).toBe(500);
    expectNoneOf(r, 'private wire prose');
    expect(r.data).toEqual(GENERIC_FAILURE);
    expect(logged()).toEqual(savedFailureLog('write', 'no-code'));
    expectRequests('write');
  });

  // portal#2405: the wire code is untrusted JSON, so a value that is not a string is its own fixture,
  // apart from the empty and the out-of-shape strings above. None of them is a code: each reads as no code.
  it.each([
    ['null', null],
    ['a number', 500],
    ['a boolean', true],
    ['an object', { nested: 'private wire prose' }],
    ['an array', ['BOOT_PROMPT_COMPILED_WRITE']],
  ] as const)('a GraphQL error whose code is %s is read as no code: generic copy, a fixed log marker', async (_label, code) => {
    const r = await save('write', { message: 'private wire prose', extensions: { code } });
    expect(r.status).toBe(500);
    expectNoneOf(r, 'private wire prose', 'BOOT_PROMPT_COMPILED_WRITE');
    expect(r.data).toEqual(GENERIC_FAILURE);
    expect(logged()).toEqual(savedFailureLog('write', 'no-code'));
    expectRequests('write');
  });
});

// portal#2405: the node read that precedes the write can fail with a GraphQL error too, not only a plain
// one. The stage is what the log names; the kind of error is what the copy and the status depend on.
describe('portal#2405 the read stage fails like the write stage, and is never classified as a refusal', () => {
  it.each([
    ['omitted code', withCode(undefined, 'private wire prose')],
    ['empty code', withCode('', 'private wire prose')],
    ['non-string code', { message: 'private wire prose', extensions: { code: 500 } } as Wire],
  ])('a GraphQL read failure with %s is a 500 with no server text, logged as the read stage', async (_label, wire) => {
    const r = await save('read', wire);
    expect(r.status).toBe(500);
    expectNoneOf(r, 'private wire prose');
    expect(r.data).toEqual(GENERIC_FAILURE);
    expect(logged()).toEqual(savedFailureLog('read', 'no-code'));
    expectRequests('read');
  });
  it('a typed boot-prompt code on the READ is not a refusal: only the write is judged for it, so it stays a 500', async () => {
    const r = await save('read', withCode('BOOT_PROMPT_COMPILED_WRITE', 'private wire prose'));
    expect(r.status).toBe(500);
    expect(r.data).toEqual(GENERIC_FAILURE);
    expectNoneOf(r, 'private wire prose', 'compiled-prompt');
    expect(logged()).toEqual(savedFailureLog('read', 'BOOT_PROMPT_COMPILED_WRITE'));
    expectRequests('read');
  });
  it('an out-of-shape code on the read is logged as the fixed marker, never as itself', async () => {
    const r = await save('read', withCode('some wire prose with content', 'private wire prose'));
    expect(r.status).toBe(500);
    expectNoneOf(r, 'private wire prose', 'some wire prose with content');
    expect(logged()).toEqual(savedFailureLog('read', 'unrecognized'));
    expectRequests('read');
  });
});
