import { describe, expect, it } from 'vitest';
import {
  anchorView,
  authorView,
  bodyView,
  commentControls,
  commentFailure,
  discussionCount,
  openFeedbackCue,
  provenanceText,
  readerOpenThreadId,
  type Comment,
  type DiscussionThread,
  type CommentAuthor,
  type CommentPermissions,
} from './comments';

const ref = (over: Partial<{ id: string; name: string | null; handle: string | null; urn: string | null }> = {}) => ({
  id: 'x',
  name: null,
  handle: null,
  urn: null,
  ...over,
});

const author = (over: Partial<CommentAuthor>): CommentAuthor => ({
  kind: 'USER',
  worker: null,
  user: null,
  agent: null,
  app: null,
  ...over,
});

describe('authorView', () => {
  it('a worker is the author, with its URN, and the binding user plays no part (110:03)', () => {
    const v = authorView(
      author({
        kind: 'WORKER',
        worker: ref({ name: 'Dara', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:dara' }),
        user: ref({ handle: 'holger' }),
      }),
    );
    expect(v).toEqual({ kind: 'WORKER', label: 'Dara', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:dara', agent: null });
  });

  it('an unnamed agent is shown beside its user, so agent-written feedback is distinguishable', () => {
    const v = authorView(
      author({
        kind: 'USER_AGENT',
        user: ref({ handle: 'holger', name: 'Holger' }),
        agent: ref({ name: 'Research bot', urn: 'hrn:agent:hadronmemory.com:research' }),
      }),
    );
    expect(v.label).toBe('@holger');
    expect(v.agent).toEqual({ label: 'Research bot', urn: 'hrn:agent:hadronmemory.com:research' });
  });

  it('a user prefers the handle, then the name, then a neutral fallback', () => {
    expect(authorView(author({ user: ref({ handle: 'ana', name: 'Ana' }) })).label).toBe('@ana');
    expect(authorView(author({ user: ref({ handle: '  ', name: 'Ana' }) })).label).toBe('Ana');
    expect(authorView(author({ user: null })).label).toBe('A user');
  });

  it('an App author carries the App URN', () => {
    const v = authorView(author({ kind: 'APP', app: ref({ name: 'Chatbot', urn: 'hrn:app:acme.com:chatbot' }) }));
    expect(v).toMatchObject({ kind: 'APP', label: 'Chatbot', urn: 'hrn:app:acme.com:chatbot' });
  });
});

describe('anchorView', () => {
  it('is current only when the anchor matches the revision the page SHOWS', () => {
    expect(anchorView({ anchorRevision: 4 }, 4)).toMatchObject({ current: true, revision: 4 });
  });

  it('labels a thread on an older revision with that revision, not as being about the shown text (110:01)', () => {
    const v = anchorView({ anchorRevision: 2 }, 5);
    expect(v.current).toBe(false);
    expect(v.text).toBe('On revision 2, not the text shown here');
  });

  it('with no shown revision, never claims the thread is current', () => {
    expect(anchorView({ anchorRevision: 3 }, null).current).toBe(false);
    expect(anchorView({ anchorRevision: 3 }, undefined).current).toBe(false);
  });
});

describe('bodyView', () => {
  it('a retracted or hidden comment is a stub, never its text', () => {
    expect(bodyView({ body: null, quote: null, retracted: true, hidden: false })).toEqual({ kind: 'retracted' });
    expect(bodyView({ body: null, quote: null, retracted: false, hidden: true })).toEqual({ kind: 'hidden' });
    // Hidden wins: an admin's hide is the stronger state to show.
    expect(bodyView({ body: null, quote: null, retracted: true, hidden: true })).toEqual({ kind: 'hidden' });
  });

  it('a live comment shows its body and quote', () => {
    expect(bodyView({ body: 'Typo in §2', quote: 'recieve', retracted: false, hidden: false })).toEqual({
      kind: 'text',
      body: 'Typo in §2',
      quote: 'recieve',
    });
  });
});

describe('commentControls', () => {
  const writer: CommentPermissions = { canWrite: true, canManage: false };
  const reader: CommentPermissions = { canWrite: false, canManage: false };
  const admin: CommentPermissions = { canWrite: true, canManage: true };
  const openRoot = { isTopLevel: true, retracted: false, hidden: false, state: 'OPEN' as const };
  const resolvedRoot = { ...openRoot, state: 'RESOLVED' as const };
  const reply = { isTopLevel: false, retracted: false, hidden: false };

  it('a read-only reader gets no controls at all (110:03)', () => {
    const c = commentControls(openRoot, openRoot, reader, true);
    expect(Object.values(c).every((v) => v === false)).toBe(true);
  });

  it('a writer who is not the author can reply and resolve, but not edit or retract (110:05)', () => {
    expect(commentControls(openRoot, openRoot, writer, false)).toEqual({
      reply: true,
      edit: false,
      retract: false,
      resolve: true,
      reopen: false,
      hide: false,
      deleteThread: false,
    });
  });

  it('the author may edit and retract their own comment', () => {
    const c = commentControls(reply, openRoot, writer, true);
    expect(c.edit).toBe(true);
    expect(c.retract).toBe(true);
    // A reply is never resolved or reopened on its own.
    expect(c.resolve).toBe(false);
    expect(c.reopen).toBe(false);
  });

  it('a resolved thread offers Reopen, and still takes replies (DAB)', () => {
    const c = commentControls(resolvedRoot, resolvedRoot, writer, false);
    expect(c.reopen).toBe(true);
    expect(c.resolve).toBe(false);
    expect(c.reply).toBe(true);
    // ...but not from a reader without write access.
    expect(commentControls(resolvedRoot, resolvedRoot, reader, false).reply).toBe(false);
  });

  it('a retracted comment takes no edit, retract or resolve, but its open thread still takes replies', () => {
    const retractedReply = { ...reply, retracted: true };
    const c = commentControls(retractedReply, openRoot, writer, true);
    expect(c).toMatchObject({ edit: false, retract: false, resolve: false, reply: true });
  });

  it('a retracted root closes the thread to replies', () => {
    const retractedRoot = { ...openRoot, retracted: true };
    expect(commentControls(reply, retractedRoot, writer, false).reply).toBe(false);
  });

  it('a hidden comment offers an admin only the thread delete', () => {
    const hiddenRoot = { ...openRoot, hidden: true };
    expect(commentControls(hiddenRoot, hiddenRoot, admin, true)).toEqual({
      reply: false,
      edit: false,
      retract: false,
      resolve: false,
      reopen: false,
      hide: false,
      deleteThread: true,
    });
  });

  it('only an admin may hide or delete a thread', () => {
    expect(commentControls(openRoot, openRoot, writer, true)).toMatchObject({ hide: false, deleteThread: false });
    expect(commentControls(openRoot, openRoot, admin, false)).toMatchObject({ hide: true, deleteThread: true });
    expect(commentControls(reply, openRoot, admin, false).deleteThread).toBe(false);
  });
});

describe('provenanceText', () => {
  it('names who bound a worker session, as provenance', () => {
    expect(provenanceText(ref({ handle: 'holger' }))).toBe('session bound by @holger');
  });

  it('says nothing when the server withholds it', () => {
    expect(provenanceText(null)).toBeNull();
  });
});

describe('openFeedbackCue', () => {
  it('says nothing when there is no open feedback', () => {
    expect(openFeedbackCue(null)).toBeNull();
    expect(openFeedbackCue({ openThreads: 0, resolvedThreads: 3, comments: 7 })).toBeNull();
  });

  it('counts open discussions', () => {
    expect(openFeedbackCue({ openThreads: 1, resolvedThreads: 0, comments: 1 })).toBe('1 open discussion');
    expect(openFeedbackCue({ openThreads: 3, resolvedThreads: 0, comments: 5 })).toBe('3 open discussions');
  });
});

describe('commentFailure', () => {
  it('maps each typed refusal to fixed copy, never the server prose', () => {
    expect(commentFailure('COMMENT_OPEN_THREAD_EXISTS', 'create').status).toBe(409);
    expect(commentFailure('COMMENT_NOT_AUTHOR', 'edit').status).toBe(403);
    expect(commentFailure('COMMENT_TARGET_NOT_FOUND', 'create').status).toBe(404);
    expect(commentFailure('COMMENT_BODY_INVALID', 'reply').status).toBe(422);
  });

  it('a thread-state refusal names the state the reader asked for', () => {
    expect(commentFailure('COMMENT_THREAD_STATE', 'resolve').text).toBe('This discussion is already resolved.');
    expect(commentFailure('COMMENT_THREAD_STATE', 'reopen').text).toBe('This discussion is already open.');
  });

  it('an untyped failure of a post is an unknown outcome, so the reader checks before posting again', () => {
    expect(commentFailure(null, 'create').text).toMatch(/couldn't confirm your comment was posted/);
    expect(commentFailure('INTERNAL_SERVER_ERROR', 'reply').text).toMatch(/couldn't confirm your comment was posted/);
    expect(commentFailure(undefined, 'resolve').text).toMatch(/couldn't confirm the change went through/);
  });
});

describe('readerOpenThreadId', () => {
  const root = (id: string, over: Partial<Comment> = {}) => ({ id, state: 'OPEN', retracted: false, hidden: false, ...over }) as Comment;
  const th = (r: Comment, mine: boolean): DiscussionThread => ({ root: r, replies: [], replyCount: 0, mine: { [r.id]: mine } });

  it("finds the reader's own open thread", () => {
    expect(readerOpenThreadId([th(root('a'), false), th(root('b'), true)])).toBe('b');
  });

  it('ignores resolved, retracted and hidden threads, and other authors', () => {
    expect(readerOpenThreadId([th(root('a', { state: 'RESOLVED' }), true), th(root('b', { retracted: true }), true), th(root('c', { hidden: true }), true), th(root('d'), false)])).toBeNull();
  });
});

describe('discussionCount', () => {
  it('counts open and resolved discussions', () => {
    expect(discussionCount({ openThreads: 2, resolvedThreads: 3, comments: 9 })).toBe(5);
    expect(discussionCount(null)).toBe(0);
  });
});
