/**
 * portal#1175 — a comment's text is saved through `editComment`, never the
 * generic `updateNode`, which the server refuses for a comment
 * (hrn:node:hadronmemory.com:specs:cor:dmo:110:04; Glen's READ on #1180).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { EDIT_COMMENT_MUTATION } from '$lib/server/comments';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$app/forms', () => ({ deserialize: vi.fn() }));

function gqlError(code: string, message = code) {
  return Object.assign(new Error(message), { response: { errors: [{ message, extensions: { code } }] } });
}
const COMMENT = {
  id: 'pk', memoryId: 'mem-1', loc: 'c1', tags: [], content: 'old', abstract: null, revision: 9, role: null, isRunnable: null,
  nodeType: 'comment',
  asComment: { id: 'cmt-1', deleted: false, viewerIsAuthor: true, revSeq: 3, target: { id: 't', name: 'T', nodeType: 'info', urn: 'hrn:node:a:b:t' } },
};

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockImplementation(async (query: unknown) => {
    if (query === NODE_BY_ID_QUERY) return { node: COMMENT };
    return { editComment: { id: 'cmt-1' } };
  });
});

async function save(form: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.set(k, v);
  return (actions as Record<string, (e: never) => Promise<unknown>>).updateContent({
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
  } as never);
}
const writes = () => mockRequest.mock.calls.filter(([q]) => q !== NODE_BY_ID_QUERY);

describe('updateContent on a comment (#1175)', () => {
  it('sends editComment with the comment id, the new body and the posted revision, and no generic node write', async () => {
    const res = await save({ content: 'new body', expectedRevision: '3' });
    expect(res).toEqual({ contentSaved: true });
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe(EDIT_COMMENT_MUTATION);
    expect(writes()[0][1]).toEqual({ commentRef: 'cmt-1', body: 'new body', expectedRevision: 3 });
  });

  it('refuses a save with no revision instead of sending it unguarded', async () => {
    const res = (await save({ content: 'x' })) as { status: number; data: { contentFailed: { code: string } } };
    expect(res.status).toBe(400);
    expect(res.data.contentFailed.code).toBe('no-baseline');
    expect(writes()).toHaveLength(0);
  });

  it('a concurrent change is the page\'s conflict, so the draft is kept', async () => {
    mockRequest.mockImplementation(async (query: unknown) => {
      if (query === NODE_BY_ID_QUERY) return { node: COMMENT };
      throw gqlError('NODE_WRITE_CONFLICT');
    });
    const res = (await save({ content: 'x', expectedRevision: '3' })) as { status: number; data: { contentFailed: { code: string } } };
    expect(res.status).toBe(409);
    expect(res.data.contentFailed.code).toBe('changed');
  });

  it("someone else's comment is refused with the server's reason, never written", async () => {
    mockRequest.mockImplementation(async (query: unknown) => {
      if (query === NODE_BY_ID_QUERY) return { node: COMMENT };
      throw gqlError('COMMENT_NOT_AUTHOR');
    });
    const res = (await save({ content: 'x', expectedRevision: '3' })) as { status: number; data: { contentFailed: { code: string; detail: string } } };
    expect(res.status).toBe(403);
    expect(res.data.contentFailed.code).toBe('failed');
    expect(res.data.contentFailed.detail).toContain('Only the author');
  });

  it('a comment whose details were not returned is refused, not sent as a generic write', async () => {
    mockRequest.mockImplementation(async (query: unknown) => (query === NODE_BY_ID_QUERY ? { node: { ...COMMENT, asComment: null } } : {}));
    const res = (await save({ content: 'x', expectedRevision: '3' })) as { status: number };
    expect(res.status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
});
