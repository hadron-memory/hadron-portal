/**
 * portal#1014 — GET/POST /app/memories/[id]/nodes/[nodeId]/comments, the
 * Discussion tab's endpoint over the hadron-server#1606 comment API.
 *
 * Fixtures follow the comment-nodes contract's §4 SDL field for field.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import {
  COMMENT_THREADS_QUERY,
  CREATE_COMMENT_MUTATION,
  NODE_COMMENT_SUMMARY_QUERY,
  REPLY_TO_COMMENT_MUTATION,
  RESOLVE_COMMENT_THREAD_MUTATION,
  SELF_MEMORY_ACCESS_QUERY,
} from '$lib/server/comments';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

import { GET, POST } from './+server';

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

type Ev = Parameters<typeof POST>[0];
const ev = (body: unknown, over: { token?: string | null; memoryId?: string; impersonation?: unknown; userId?: string } = {}) =>
  ({
    params: { id: over.memoryId ?? 'mem-1', nodeId: 'node-1' },
    request: { json: async () => body },
    locals: {
      token: over.token === undefined ? 'tok' : over.token,
      user: { id: over.userId ?? 'user-1' },
      impersonation: over.impersonation ?? null,
    },
  }) as unknown as Ev;

function gqlError(code: string) {
  return new ClientError(
    { errors: [{ message: 'server prose with secrets', extensions: { code } }] as never, status: 200, headers: new Headers() } as never,
    { query: '' },
  );
}

const actor = (id: string, over: Record<string, unknown> = {}) => ({ id, name: null, handle: null, urn: null, ...over });

function comment(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    urn: `hrn:node:acme.com:specs:comments:${id}`,
    target: { id: 'node-1', urn: 'hrn:node:acme.com:specs:cor:a:1', name: 'A', nodeType: 'info', revSeq: 3 },
    threadRootId: null,
    isTopLevel: true,
    anchorRevision: 3,
    anchorApprovalHash: 'a'.repeat(64),
    anchorIsCurrent: true,
    quote: null,
    body: 'Is §2 right?',
    state: 'OPEN',
    retracted: false,
    retractedAt: null,
    hidden: false,
    hiddenAt: null,
    resolvedAt: null,
    resolvedBy: null,
    author: { kind: 'USER', worker: null, user: actor('user-1', { handle: 'ana' }), agent: null, app: null },
    provenanceUser: null,
    createdAt: '2026-10-05T18:00:00.000Z',
    updatedAt: null,
    revSeq: 1,
    viewerIsAuthor: false,
    ...over,
  };
}

const head = (over: Record<string, unknown> = {}) => ({
  node: {
    id: 'node-1',
    revision: 3,
    memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:specs' },
    commentSummary: { openThreads: 1, resolvedThreads: 0, comments: 2, viewerOpenThreadId: 'c1' },
    ...over,
  },
});

const threads = () => ({
  commentThreads: {
    total: 1,
    items: [
      {
        replyCount: 1,
        root: comment('c1', { viewerIsAuthor: true }),
        replies: [
          comment('c2', {
            threadRootId: 'c1',
            isTopLevel: false,
            state: null,
            author: {
              kind: 'WORKER',
              worker: actor('w1', { name: 'Dara', urn: 'hrn:worker:acme.com:team:dara' }),
              user: null,
              agent: null,
              app: null,
            },
            provenanceUser: actor('user-9', { handle: 'binder' }),
          }),
        ],
      },
    ],
  },
});

/** Answer each document the endpoint sends; anything else fails loudly. */
function serve(over: Partial<Record<string, () => unknown>> = {}) {
  const table: Record<string, () => unknown> = {
    [NODE_COMMENT_SUMMARY_QUERY]: () => head(),
    [COMMENT_THREADS_QUERY]: () => threads(),
    [SELF_MEMORY_ACCESS_QUERY]: () => ({ effectiveAccess: { canWrite: true, canManage: false } }),
    ...over,
  };
  mockRequest.mockImplementation(async (doc: string) => {
    const answer = table[doc];
    if (!answer) throw new Error('unexpected document');
    return answer();
  });
}

const sent = (doc: string) => mockRequest.mock.calls.filter(([d]) => d === doc).map(([, vars]) => vars);

describe('GET comments (portal#1014)', () => {
  it('401s without a token, without calling the server', async () => {
    expect((await GET(ev(null, { token: null }))).status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("returns threads, permissions and the summary, marking the reader's comments by the server's viewerIsAuthor", async () => {
    serve();
    const res = await GET(ev(null));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toEqual({ openThreads: 1, resolvedThreads: 0, comments: 2, viewerOpenThreadId: 'c1' });
    expect(body.discussion.ok).toBe(true);
    expect(body.discussion.permissions).toEqual({ canWrite: true, canManage: false });
    // The server says the reader wrote the root; the worker wrote the reply, whoever bound it.
    expect(body.discussion.threads[0].mine).toEqual({ c1: true, c2: false });
    expect(sent(SELF_MEMORY_ACCESS_QUERY)).toEqual([{ user: 'user-1', resource: 'hrn:mem:acme.com:specs' }]);
  });

  it('authorship is the server\'s answer: a matching user id without viewerIsAuthor is not the reader\'s', async () => {
    serve({
      [COMMENT_THREADS_QUERY]: () => ({
        commentThreads: { total: 1, items: [{ replyCount: 0, root: comment('c1', { viewerIsAuthor: false }), replies: [] }] },
      }),
    });
    const body = await (await GET(ev(null, { userId: 'user-1' }))).json();
    expect(body.discussion.threads[0].mine).toEqual({ c1: false });
  });

  it('404s a node that lives in another memory than the URL names', async () => {
    serve({ [NODE_COMMENT_SUMMARY_QUERY]: () => head({ memory: { id: 'mem-OTHER', urn: 'hrn:mem:acme.com:other' } }) });
    expect((await GET(ev(null))).status).toBe(404);
    expect(sent(COMMENT_THREADS_QUERY)).toEqual([]);
  });

  it('a failed thread read is a failure, never an empty discussion', async () => {
    serve({
      [COMMENT_THREADS_QUERY]: () => {
        throw new Error('boom');
      },
    });
    const res = await GET(ev(null));
    expect(res.status).toBe(502);
    expect((await res.json()).discussion).toBeUndefined();
  });

  it('an impersonating reader gets no write permissions, without asking the server', async () => {
    serve();
    const body = await (await GET(ev(null, { impersonation: { sessionId: 's' } }))).json();
    expect(body.discussion.permissions).toEqual({ canWrite: false, canManage: false });
    expect(sent(SELF_MEMORY_ACCESS_QUERY)).toEqual([]);
  });
});

describe('POST comments (portal#1014)', () => {
  it('400s a malformed write without sending anything', async () => {
    serve();
    for (const body of [null, {}, { op: 'nuke' }, { op: 'create', body: 'x' }, { op: 'resolve', commentId: 'c1' }, { op: 'reply', body: 'x' }]) {
      mockRequest.mockClear();
      expect((await POST(ev(body))).status).toBe(400);
      expect(mockRequest).not.toHaveBeenCalled();
    }
  });

  it('anchors a new thread to the revision the reader saw, then answers with the fresh discussion', async () => {
    serve({ [CREATE_COMMENT_MUTATION]: () => ({ createComment: { id: 'c9' } }) });
    const res = await POST(ev({ op: 'create', body: 'Typo', anchorRevision: 2 }));
    expect(res.status).toBe(200);
    expect(sent(CREATE_COMMENT_MUTATION)).toEqual([{ targetRef: 'node-1', body: 'Typo', anchorRevision: 2 }]);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.discussion.threads).toHaveLength(1);
    expect(body.summary.openThreads).toBe(1);
  });

  it('a reply addresses the thread, and a resolve sends the revision the reader saw', async () => {
    serve({
      [REPLY_TO_COMMENT_MUTATION]: () => ({ replyToComment: { id: 'c3' } }),
      [RESOLVE_COMMENT_THREAD_MUTATION]: () => ({ resolveCommentThread: { id: 'c1' } }),
    });
    await POST(ev({ op: 'reply', commentId: 'c1', body: 'Agreed' }));
    await POST(ev({ op: 'resolve', commentId: 'c1', expectedRevision: 1 }));
    expect(sent(REPLY_TO_COMMENT_MUTATION)).toEqual([{ commentRef: 'c1', body: 'Agreed' }]);
    expect(sent(RESOLVE_COMMENT_THREAD_MUTATION)).toEqual([{ commentRef: 'c1', expectedRevision: 1 }]);
  });

  it('a typed refusal gets fixed copy and its status, never the server prose, plus the fresh state', async () => {
    serve({
      [CREATE_COMMENT_MUTATION]: () => {
        throw gqlError('COMMENT_OPEN_THREAD_EXISTS');
      },
    });
    const res = await POST(ev({ op: 'create', body: 'Again', anchorRevision: 3 }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('COMMENT_OPEN_THREAD_EXISTS');
    expect(body.error).toContain('already have an open discussion');
    expect(body.error).not.toContain('server prose');
    expect(body.discussion.ok).toBe(true);
  });

  it('an untyped failure of a post is an unknown outcome, not "nothing happened"', async () => {
    serve({
      [CREATE_COMMENT_MUTATION]: () => {
        throw new Error('socket hang up');
      },
    });
    const res = await POST(ev({ op: 'create', body: 'Hm', anchorRevision: 3 }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/couldn't confirm your comment was posted/);
  });

  it('refuses to write under a memory the node does not live in', async () => {
    serve({ [NODE_COMMENT_SUMMARY_QUERY]: () => head({ memory: { id: 'mem-OTHER', urn: 'hrn:mem:acme.com:other' } }) });
    expect((await POST(ev({ op: 'create', body: 'x', anchorRevision: 3 }))).status).toBe(404);
    expect(sent(CREATE_COMMENT_MUTATION)).toEqual([]);
  });

  it('a write that landed but could not be read back says so', async () => {
    serve({
      [CREATE_COMMENT_MUTATION]: () => ({ createComment: { id: 'c9' } }),
      [COMMENT_THREADS_QUERY]: () => {
        throw new Error('boom');
      },
    });
    const res = await POST(ev({ op: 'create', body: 'x', anchorRevision: 3 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.discussion).toBeUndefined();
  });
});
