/**
 * portal#1014: reading and writing a node's discussion (hadron-server#1606).
 *
 * The documents follow the comment-nodes machine contract,
 * `hrn:node:hadronmemory.com:hadron-server:design:comment-nodes-contract` §4.
 * They validate against the server SDL only once #1606 ships it, which is why
 * the PR that adds them stays a draft until then.
 */
import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { commentFailure, type CommentAction, type CommentPermissions, type CommentSummary, type CommentThread, type Discussion, type DiscussionThread } from '$lib/comments';

const COMMENT_ACTOR_FIELDS = /* GraphQL */ `
  fragment CommentActorFields on CommentActorRef { id name handle urn }
`;

const COMMENT_FIELDS = /* GraphQL */ `
  ${COMMENT_ACTOR_FIELDS}
  fragment CommentFields on Comment {
    id
    urn
    target { id urn name nodeType revSeq }
    threadRootId
    isTopLevel
    anchorRevision
    anchorApprovalHash
    anchorIsCurrent
    quote
    body
    state
    retracted
    retractedAt
    hidden
    hiddenAt
    resolvedAt
    resolvedBy { ...CommentActorFields }
    author {
      kind
      worker { ...CommentActorFields }
      user { ...CommentActorFields }
      agent { ...CommentActorFields }
      app { ...CommentActorFields }
    }
    provenanceUser { ...CommentActorFields }
    createdAt
    updatedAt
    revSeq
    viewerIsAuthor
  }
`;

/** The page of threads the Discussion tab shows, newest activity as the server orders it. */
export const COMMENT_THREADS_QUERY = /* GraphQL */ `
  ${COMMENT_FIELDS}
  query CommentThreads($targetRef: ID!, $limit: Int, $offset: Int) {
    commentThreads(targetRef: $targetRef, limit: $limit, offset: $offset) {
      total
      items {
        replyCount
        root { ...CommentFields }
        replies { ...CommentFields }
      }
    }
  }
`;

/**
 * The trust cue (`hrn:node:hadronmemory.com:specs:cor:dmo:110:07`), read on its own so the header can show it
 * without the threads. It also carries what the endpoint must check: which
 * memory the node lives in, and the revision it is at.
 */
export const NODE_COMMENT_SUMMARY_QUERY = /* GraphQL */ `
  query NodeCommentSummary($ref: ID!) {
    node(ref: $ref) {
      id
      revision
      memory { id urn }
      commentSummary { openThreads resolvedThreads comments viewerOpenThreadId }
    }
  }
`;

export interface NodeCommentHead {
  id: string;
  revision: number;
  memory: { id: string; urn: string } | null;
  commentSummary: CommentSummary;
}

/** May the caller write (comment) and manage (hide, delete) the target's memory? */
export const SELF_MEMORY_ACCESS_QUERY = /* GraphQL */ `
  query SelfMemoryAccess($user: ID!, $resource: ID!) {
    effectiveAccess(user: $user, resource: $resource) { canWrite canManage }
  }
`;

export const CREATE_COMMENT_MUTATION = /* GraphQL */ `
  mutation CreateComment($targetRef: ID!, $body: String!, $quote: String, $anchorRevision: Int) {
    createComment(targetRef: $targetRef, body: $body, quote: $quote, anchorRevision: $anchorRevision) { id }
  }
`;

export const REPLY_TO_COMMENT_MUTATION = /* GraphQL */ `
  mutation ReplyToComment($commentRef: ID!, $body: String!) {
    replyToComment(commentRef: $commentRef, body: $body) { id }
  }
`;

export const EDIT_COMMENT_MUTATION = /* GraphQL */ `
  mutation EditComment($commentRef: ID!, $body: String, $expectedRevision: Int!) {
    editComment(commentRef: $commentRef, body: $body, expectedRevision: $expectedRevision) { id }
  }
`;

export const RETRACT_COMMENT_MUTATION = /* GraphQL */ `
  mutation RetractComment($commentRef: ID!, $expectedRevision: Int!) {
    retractComment(commentRef: $commentRef, expectedRevision: $expectedRevision) { id }
  }
`;

export const RESOLVE_COMMENT_THREAD_MUTATION = /* GraphQL */ `
  mutation ResolveCommentThread($commentRef: ID!, $expectedRevision: Int!) {
    resolveCommentThread(commentRef: $commentRef, expectedRevision: $expectedRevision) { id }
  }
`;

export const REOPEN_COMMENT_THREAD_MUTATION = /* GraphQL */ `
  mutation ReopenCommentThread($commentRef: ID!, $expectedRevision: Int!) {
    reopenCommentThread(commentRef: $commentRef, expectedRevision: $expectedRevision) { id }
  }
`;

export const HIDE_COMMENT_MUTATION = /* GraphQL */ `
  mutation HideComment($commentRef: ID!, $reason: String!, $expectedRevision: Int!) {
    hideComment(commentRef: $commentRef, reason: $reason, expectedRevision: $expectedRevision) { id }
  }
`;

export const DELETE_COMMENT_THREAD_MUTATION = /* GraphQL */ `
  mutation DeleteCommentThread($commentRef: ID!, $reason: String!) {
    deleteCommentThread(commentRef: $commentRef, reason: $reason)
  }
`;

/** How many threads the tab loads. The tab says when there are more, never implying it shows all. */
export const THREAD_PAGE_SIZE = 50;


/** Per comment: did the reader write it. The server's `viewerIsAuthor`, never inferred from names or ids. */
function markMine(thread: CommentThread): DiscussionThread {
  const mine: Record<string, boolean> = {};
  for (const c of [thread.root, ...thread.replies]) mine[c.id] = c.viewerIsAuthor === true;
  return { ...thread, mine };
}

/**
 * The reader's permissions on the target's memory. Impersonation can't write
 * comments (`COMMENT_IMPERSONATION_REFUSED`), so it offers no controls. A failed
 * check offers none either: a control the server would refuse is worse than a
 * missing one, and the discussion still reads.
 */
export async function readPermissions(
  client: GraphQLClient,
  userId: string | null | undefined,
  memoryUrn: string | null | undefined,
  impersonating: boolean,
): Promise<CommentPermissions> {
  if (!userId || !memoryUrn || impersonating) return { canWrite: false, canManage: false };
  try {
    const r = await client.request<{ effectiveAccess: { canWrite: boolean; canManage: boolean } }>(SELF_MEMORY_ACCESS_QUERY, {
      user: userId,
      resource: memoryUrn,
    });
    return { canWrite: r.effectiveAccess.canWrite === true, canManage: r.effectiveAccess.canManage === true };
  } catch (e) {
    console.warn('[comments] access check failed:', e);
    return { canWrite: false, canManage: false };
  }
}

/** The node's discussion. A failed read is `{ ok: false }`, never an empty discussion. */
export async function loadDiscussion(
  client: GraphQLClient,
  nodeId: string,
  reader: { userId: string | null | undefined; memoryUrn: string | null | undefined; impersonating: boolean },
): Promise<Discussion> {
  try {
    const [r, permissions] = await Promise.all([
      client.request<{ commentThreads: { total: number; items: CommentThread[] } }>(COMMENT_THREADS_QUERY, {
        targetRef: nodeId,
        limit: THREAD_PAGE_SIZE,
        offset: 0,
      }),
      readPermissions(client, reader.userId, reader.memoryUrn, reader.impersonating),
    ]);
    return {
      ok: true,
      threads: r.commentThreads.items.map(markMine),
      total: r.commentThreads.total,
      permissions,
    };
  } catch (e) {
    console.warn('[comments] thread read failed:', e);
    return { ok: false };
  }
}

/**
 * The node's comment head: the summary for the header cue, plus its memory and
 * revision. Null when the node is gone or unreadable; a thrown error is a
 * failed read, which the caller reports as such.
 */
export async function readCommentHead(client: GraphQLClient, nodeId: string): Promise<NodeCommentHead | null> {
  const r = await client.request<{ node: NodeCommentHead | null }>(NODE_COMMENT_SUMMARY_QUERY, { ref: nodeId });
  return r.node ?? null;
}

/** The open-feedback summary for the header cue, or null when it couldn't be read. */
export async function loadCommentSummary(client: GraphQLClient, nodeId: string): Promise<CommentSummary | null> {
  try {
    return (await readCommentHead(client, nodeId))?.commentSummary ?? null;
  } catch (e) {
    console.warn('[comments] summary read failed:', e);
    return null;
  }
}

// ── Writes ─────────────────────────────────────────────────────────────

export type CommentWrite =
  | { op: 'create'; body: string; anchorRevision: number }
  | { op: 'reply'; commentId: string; body: string }
  | { op: 'edit'; commentId: string; body: string; expectedRevision: number }
  | { op: 'retract'; commentId: string; expectedRevision: number }
  | { op: 'resolve'; commentId: string; expectedRevision: number }
  | { op: 'reopen'; commentId: string; expectedRevision: number }
  | { op: 'hide'; commentId: string; reason: string; expectedRevision: number }
  | { op: 'delete'; commentId: string; reason: string };

const OPS: ReadonlySet<CommentAction> = new Set(['create', 'reply', 'edit', 'retract', 'resolve', 'reopen', 'hide', 'delete']);

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function revision(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null;
}

/**
 * Parse a request body into one write, or null when it is malformed. Text is
 * passed through as typed: the server owns the body rules
 * (`COMMENT_BODY_INVALID`), so the portal doesn't keep a second copy of them.
 */
export function parseCommentWrite(body: unknown): CommentWrite | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const op = str(b.op);
  if (!op || !OPS.has(op as CommentAction)) return null;
  const commentId = str(b.commentId);
  const text = str(b.body);
  const reason = str(b.reason);
  const expectedRevision = revision(b.expectedRevision);
  switch (op) {
    case 'create': {
      const anchorRevision = revision(b.anchorRevision);
      return text !== null && anchorRevision !== null ? { op, body: text, anchorRevision } : null;
    }
    case 'reply':
      return commentId && text !== null ? { op, commentId, body: text } : null;
    case 'edit':
      return commentId && text !== null && expectedRevision !== null ? { op, commentId, body: text, expectedRevision } : null;
    case 'retract':
    case 'resolve':
    case 'reopen':
      return commentId && expectedRevision !== null ? { op, commentId, expectedRevision } : null;
    case 'hide':
      return commentId && reason !== null && expectedRevision !== null ? { op, commentId, reason, expectedRevision } : null;
    case 'delete':
      return commentId && reason !== null ? { op, commentId, reason } : null;
    default:
      return null;
  }
}

/**
 * Send one write. `targetId` is the node the page shows; a new thread is
 * anchored to the revision the reader was looking at (`hrn:node:hadronmemory.com:specs:cor:dmo:110:01`), so a
 * concurrent edit can't silently re-anchor it to text they never read.
 */
export async function sendCommentWrite(
  client: GraphQLClient,
  targetId: string,
  w: CommentWrite,
): Promise<{ ok: true } | { ok: false; status: number; text: string; code: string | null }> {
  try {
    switch (w.op) {
      case 'create':
        await client.request(CREATE_COMMENT_MUTATION, { targetRef: targetId, body: w.body, anchorRevision: w.anchorRevision });
        break;
      case 'reply':
        await client.request(REPLY_TO_COMMENT_MUTATION, { commentRef: w.commentId, body: w.body });
        break;
      case 'edit':
        await client.request(EDIT_COMMENT_MUTATION, { commentRef: w.commentId, body: w.body, expectedRevision: w.expectedRevision });
        break;
      case 'retract':
        await client.request(RETRACT_COMMENT_MUTATION, { commentRef: w.commentId, expectedRevision: w.expectedRevision });
        break;
      case 'resolve':
        await client.request(RESOLVE_COMMENT_THREAD_MUTATION, { commentRef: w.commentId, expectedRevision: w.expectedRevision });
        break;
      case 'reopen':
        await client.request(REOPEN_COMMENT_THREAD_MUTATION, { commentRef: w.commentId, expectedRevision: w.expectedRevision });
        break;
      case 'hide':
        await client.request(HIDE_COMMENT_MUTATION, { commentRef: w.commentId, reason: w.reason, expectedRevision: w.expectedRevision });
        break;
      case 'delete':
        await client.request(DELETE_COMMENT_THREAD_MUTATION, { commentRef: w.commentId, reason: w.reason });
        break;
    }
    return { ok: true };
  } catch (e) {
    const code = extractGqlErrorCode(e);
    const { status, text } = commentFailure(code, w.op);
    if (status === 500) console.error(`[comments] ${w.op} failed:`, e);
    return { ok: false, status, text, code };
  }
}
