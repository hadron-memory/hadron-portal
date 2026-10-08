/**
 * portal#1014: comment threads beside a node (hadron-server#1606/#1607),
 * turned into what the portal renders. Pure: no fetching, no DOM.
 *
 * The shapes mirror the machine contract posted before the server code,
 * `hrn:node:hadronmemory.com:hadron-server:design:comment-nodes-contract`
 * (§4 SDL, §5 refusals). The specs are the children of
 * `hrn:node:hadronmemory.com:specs:cor:dmo:110`, cited below by their last two parts:
 *
 * - A thread is anchored to the revision of the target its author read
 *   (`110:01`). A thread on an older revision is labelled with it, never shown
 *   as if it were about the current text.
 * - Only writers may comment (`110:03`). Only a comment's author edits or
 *   retracts it; writers resolve and reopen; memory admins hide and delete
 *   (`110:05`). Commenting never offers edit, approve or mint.
 * - Open feedback is a trust cue, never a gate (`110:07`).
 * - Refusals map to FIXED copy by `extensions.code`. The server's prose is
 *   never shown (the same rule as `$lib/node-approval` and `$lib/node-mint`).
 */
import { t } from '$lib/i18n/t';

export type CommentThreadState = 'OPEN' | 'RESOLVED';
export type CommentAuthorKind = 'WORKER' | 'USER' | 'USER_AGENT' | 'APP';

export interface CommentActorRef {
  id: string;
  name: string | null;
  handle: string | null;
  urn: string | null;
}

export interface CommentAuthor {
  kind: CommentAuthorKind;
  worker: CommentActorRef | null;
  user: CommentActorRef | null;
  agent: CommentActorRef | null;
  app: CommentActorRef | null;
}

export interface CommentTargetRef {
  id: string;
  urn: string;
  name: string;
  nodeType: string;
  revSeq: number;
}

export interface Comment {
  id: string;
  urn: string;
  target: CommentTargetRef;
  threadRootId: string | null;
  isTopLevel: boolean;
  anchorRevision: number;
  anchorApprovalHash: string;
  anchorIsCurrent: boolean;
  /** Null when retracted or hidden: the stub shows the state, not the text. */
  quote: string | null;
  body: string | null;
  /** Top-level comments only. */
  state: CommentThreadState | null;
  retracted: boolean;
  retractedAt: string | null;
  hidden: boolean;
  hiddenAt: string | null;
  resolvedAt: string | null;
  resolvedBy: CommentActorRef | null;
  author: CommentAuthor;
  /**
   * Who bound the worker session: provenance only, never the author (`110:03`).
   * Visible to memory writers (DAB), null to everyone else.
   */
  provenanceUser: CommentActorRef | null;
  createdAt: string;
  updatedAt: string | null;
  revSeq: number;
  /** Did the caller write it, by the author key the server enforces (`w:`/`ua:`/`u:`/`app:`). */
  viewerIsAuthor: boolean;
}

export interface CommentThread {
  root: Comment;
  replies: Comment[];
  replyCount: number;
}

export interface CommentThreadPage {
  items: CommentThread[];
  total: number;
}

export interface CommentSummary {
  openThreads: number;
  resolvedThreads: number;
  comments: number;
  /** The caller's own open, live top-level thread on the node, if any (one per author, `110:05`). */
  viewerOpenThreadId?: string | null;
}

/** A thread as the Discussion tab holds it. */
export interface DiscussionThread extends CommentThread {
  /** Per comment id: did the reader write it. */
  mine: Record<string, boolean>;
}

/** The tab's data. A failed read is `{ ok: false }`, never an empty discussion. */
export type Discussion =
  | { ok: true; threads: DiscussionThread[]; total: number; permissions: CommentPermissions }
  | { ok: false };


/**
 * Memory classes whose nodes can be discussed (`hrn:node:hadronmemory.com:specs:cor:dmo:110:02`): comments
 * live in the target's memory, and `private` / `system` memories take none.
 * Used only to decide whether to offer the tab; the server refuses the rest
 * (`COMMENT_MEMORY_NOT_COMMENTABLE`) whatever this says.
 */
const COMMENTABLE_CLASSES: ReadonlySet<string> = new Set(['app', 'knowledge', 'personal', 'group']);

export function isCommentableClass(memoryClass: string | null | undefined): boolean {
  return memoryClass != null && COMMENTABLE_CLASSES.has(memoryClass);
}

/** A comment node is feedback, never a target: it has no discussion of its own (`110:00`). */
export const COMMENT_NODE_TYPE = 'comment';

// ── Authors ────────────────────────────────────────────────────────────

export interface AuthorView {
  /** Who wrote it, as a reader names them. */
  label: string;
  /** The URN to copy, when the author is addressable by one. */
  urn: string | null;
  /** The unnamed agent that wrote for the user (`USER_AGENT`), shown beside the user. */
  agent: { label: string; urn: string | null } | null;
  kind: CommentAuthorKind;
}

/** "Bound by @x" for a worker's comment, when the server shows the reader who bound it. Never the author. */
export function provenanceText(provenanceUser: CommentActorRef | null | undefined): string | null {
  if (!provenanceUser) return null;
  return t('comments.provenance', 'session bound by {user}', { user: actorLabel(provenanceUser, t('comments.author.unknown-user', 'A user')) });
}

function actorLabel(ref: CommentActorRef | null, fallback: string): string {
  const handle = ref?.handle?.trim();
  if (handle) return `@${handle}`;
  const name = ref?.name?.trim();
  return name || fallback;
}

/**
 * A worker is the author in its own right; the user who bound its session is
 * provenance and never takes its place (`110:03`). An unnamed agent is shown
 * beside its user, so agent-written feedback is distinguishable.
 */
export function authorView(author: CommentAuthor): AuthorView {
  switch (author.kind) {
    case 'WORKER':
      return {
        kind: 'WORKER',
        label: actorLabel(author.worker, t('comments.author.unknown-worker', 'A worker')),
        urn: author.worker?.urn ?? null,
        agent: null,
      };
    case 'USER_AGENT':
      return {
        kind: 'USER_AGENT',
        label: actorLabel(author.user, t('comments.author.unknown-user', 'A user')),
        urn: null,
        agent: { label: actorLabel(author.agent, t('comments.author.unknown-agent', 'an agent')), urn: author.agent?.urn ?? null },
      };
    case 'APP':
      return {
        kind: 'APP',
        label: actorLabel(author.app, t('comments.author.unknown-app', 'An App')),
        urn: author.app?.urn ?? null,
        agent: null,
      };
    case 'USER':
    default:
      return {
        kind: 'USER',
        label: actorLabel(author.user, t('comments.author.unknown-user', 'A user')),
        urn: null,
        agent: null,
      };
  }
}

// ── Anchors ────────────────────────────────────────────────────────────

export interface AnchorView {
  current: boolean;
  revision: number;
  text: string;
}

/**
 * Where a thread is anchored, against the revision the page shows. The
 * comparison is against the revision the READER sees, not the server's
 * `anchorIsCurrent`: a thread read after a concurrent edit must not claim to
 * be about text the page didn't render.
 */
export function anchorView(comment: Pick<Comment, 'anchorRevision'>, shownRevision: number | null | undefined): AnchorView {
  const revision = comment.anchorRevision;
  if (shownRevision != null && revision === shownRevision) {
    return { current: true, revision, text: t('comments.anchor.current', 'On this revision ({rev})', { rev: revision }) };
  }
  return {
    current: false,
    revision,
    text: t('comments.anchor.older', 'On revision {rev}, not the text shown here', { rev: revision }),
  };
}

// ── Body ───────────────────────────────────────────────────────────────

export type BodyView = { kind: 'text'; body: string; quote: string | null } | { kind: 'retracted' } | { kind: 'hidden' };

/** A retracted or hidden comment leaves a stub so its replies keep their context (`110:05`). */
export function bodyView(comment: Pick<Comment, 'body' | 'quote' | 'retracted' | 'hidden'>): BodyView {
  if (comment.hidden) return { kind: 'hidden' };
  if (comment.retracted) return { kind: 'retracted' };
  return { kind: 'text', body: comment.body ?? '', quote: comment.quote };
}

// ── Controls ───────────────────────────────────────────────────────────

export interface CommentPermissions {
  /** May write the target's memory: post, reply, resolve, reopen (`110:03`, `110:05`). */
  canWrite: boolean;
  /** Administers the target's memory: hide, delete a thread. */
  canManage: boolean;
}

export interface CommentControls {
  reply: boolean;
  edit: boolean;
  retract: boolean;
  resolve: boolean;
  reopen: boolean;
  hide: boolean;
  deleteThread: boolean;
}

const NONE: CommentControls = { reply: false, edit: false, retract: false, resolve: false, reopen: false, hide: false, deleteThread: false };

/**
 * The controls one comment offers. `viewerIsAuthor` is the server's answer to
 * "did this caller write it"; it is never inferred from a display name.
 * `thread` is the comment's thread root (itself, for a top-level comment).
 */
export function commentControls(
  comment: Pick<Comment, 'isTopLevel' | 'retracted' | 'hidden'>,
  thread: Pick<Comment, 'state' | 'retracted' | 'hidden'>,
  perms: CommentPermissions,
  viewerIsAuthor: boolean,
): CommentControls {
  // A hidden comment takes no writes but an admin's thread delete (§5 COMMENT_HIDDEN).
  if (comment.hidden) {
    return { ...NONE, deleteThread: perms.canManage && comment.isTopLevel };
  }
  const resolved = thread.state === 'RESOLVED';
  const threadLive = !thread.retracted && !thread.hidden;
  const live = !comment.retracted;
  return {
    // DAB (Holger, 2026-10-05, team chat #6989): a resolved thread still takes
    // replies, and a reply doesn't reopen it.
    reply: perms.canWrite && threadLive,
    // Editing and retracting are the author's alone, and they still need write
    // access: a writer who lost it can no longer change the memory's content.
    edit: perms.canWrite && viewerIsAuthor && live,
    retract: perms.canWrite && viewerIsAuthor && live,
    resolve: comment.isTopLevel && perms.canWrite && live && !resolved,
    reopen: comment.isTopLevel && perms.canWrite && live && resolved,
    hide: perms.canManage && live,
    deleteThread: perms.canManage && comment.isTopLevel,
  };
}

// ── The trust cue (`110:07`) ───────────────────────────────────────────

/**
 * The reader's own open thread: the one the one-open-thread rule (`110:05`)
 * would send a second post to. The server's `viewerOpenThreadId` is the
 * answer; without it (an older server, or a failed summary read), the loaded
 * threads are searched, where null means "not shown here", not "none exists".
 */
export function readerOpenThreadId(threads: DiscussionThread[], summary?: CommentSummary | null): string | null {
  if (summary && summary.viewerOpenThreadId !== undefined) return summary.viewerOpenThreadId;
  const t = threads.find((th) => th.mine[th.root.id] && th.root.state === 'OPEN' && !th.root.retracted && !th.root.hidden);
  return t?.root.id ?? null;
}

/** The tab badge: how many discussions there are, live ones only. */
export function discussionCount(summary: CommentSummary | null | undefined): number {
  return (summary?.openThreads ?? 0) + (summary?.resolvedThreads ?? 0);
}

/** A node with open discussions, as a memory-wide report lists it (`UnresolvedFeedback`, #1607). */
export interface OpenFeedback {
  urn: string;
  openThreads: number;
}

/** The open-feedback cue, or null when there's none to show. Never a gate. */
export function openFeedbackCue(summary: CommentSummary | null | undefined): string | null {
  const n = summary?.openThreads ?? 0;
  if (n <= 0) return null;
  return n === 1
    ? t('comments.cue.open-one', '1 open discussion')
    : t('comments.cue.open-many', '{n} open discussions', { n });
}

/** The move refusal for a node whose discussions can't follow it (`COMMENT_MOVE_UNCOMMENTABLE`, `110:02`). */
export function commentMoveRefusedText(): string {
  return t(
    'comments.refused.move',
    "This node has discussions, and the destination memory can't hold comments, so it wasn't moved. A memory admin can delete the discussions first.",
  );
}

// ── Refusals ───────────────────────────────────────────────────────────

export type CommentAction = 'create' | 'reply' | 'edit' | 'retract' | 'resolve' | 'reopen' | 'hide' | 'delete';

/**
 * Fixed copy for a refused comment write, keyed by the contract's §5 codes.
 * A typed refusal is raised before anything is written, so "nothing changed"
 * is true for it. Anything else is an unknown outcome: the write may or may
 * not have gone through, and saying otherwise would invite a duplicate post.
 */
export function commentFailure(code: string | null | undefined, action: CommentAction): { status: 403 | 404 | 409 | 422 | 500; text: string } {
  switch (code) {
    case 'COMMENT_NOT_FOUND':
      return { status: 404, text: t('comments.refused.not-found', 'This comment no longer exists, or you no longer have access to it. Reload to see the discussion as it is now.') };
    case 'COMMENT_TARGET_IS_COMMENT':
      return { status: 422, text: t('comments.refused.target-is-comment', 'A comment can’t be discussed on its own. Reply in its thread instead.') };
    case 'COMMENT_TARGET_NOT_FOUND':
      return { status: 404, text: t('comments.refused.target-not-found', 'This node no longer exists, or you no longer have access to it.') };
    case 'COMMENT_FORBIDDEN':
    case 'FORBIDDEN':
      return { status: 403, text: t('comments.refused.forbidden', "You can read this discussion, but you don't have permission to write in this memory.") };
    case 'COMMENT_MEMORY_NOT_COMMENTABLE':
      return { status: 422, text: t('comments.refused.not-commentable', "Nodes in this memory can't be discussed.") };
    case 'COMMENT_OPEN_THREAD_EXISTS':
      return {
        status: 409,
        text: t('comments.refused.open-thread', 'You already have an open discussion on this node. Reply there, or resolve or retract it to start a new one.'),
      };
    case 'COMMENT_ANCHOR_REVISION_INVALID':
    case 'COMMENT_ANCHOR_REVISION_UNAVAILABLE':
      return { status: 409, text: t('comments.refused.anchor', 'The revision you were reading is no longer available. Reload the page and try again.') };
    case 'COMMENT_NOT_AUTHOR':
      return { status: 403, text: t('comments.refused.not-author', 'Only the author of a comment can change or retract it.') };
    case 'COMMENT_RETRACTED':
      return { status: 409, text: t('comments.refused.retracted', 'This comment has been retracted, so it no longer takes changes.') };
    case 'COMMENT_HIDDEN':
      return { status: 409, text: t('comments.refused.hidden', 'This comment has been hidden by an administrator.') };
    case 'COMMENT_NOT_TOP_LEVEL':
      return { status: 422, text: t('comments.refused.not-top-level', 'Only a whole discussion can be resolved or reopened, not a single reply.') };
    case 'COMMENT_THREAD_STATE':
      return {
        status: 409,
        text:
          action === 'reopen'
            ? t('comments.refused.already-open', 'This discussion is already open.')
            : t('comments.refused.already-resolved', 'This discussion is already resolved.'),
      };
    case 'COMMENT_ADMIN_REQUIRED':
      return { status: 403, text: t('comments.refused.admin', 'Only an administrator of this memory can do that.') };
    case 'COMMENT_IMPERSONATION_REFUSED':
      return { status: 403, text: t('comments.refused.impersonation', "Comments can't be written while you're acting as another user.") };
    case 'COMMENT_BODY_INVALID':
      return { status: 422, text: t('comments.refused.body', "A comment can't be empty or longer than the length limit.") };
    case 'NODE_WRITE_CONFLICT':
      return { status: 409, text: t('comments.refused.conflict', 'Someone changed this comment while you were reading it. Reload to see the current version.') };
    default:
      return {
        status: 500,
        text:
          action === 'create' || action === 'reply'
            ? t('comments.unknown.post', "We couldn't confirm your comment was posted. Reload to check before posting it again.")
            : t('comments.unknown.change', "We couldn't confirm the change went through. Reload to see the current state."),
      };
  }
}
