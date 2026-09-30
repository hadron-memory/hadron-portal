import type { TeamChatMessage } from '$lib/types';

/** How often the thread refetches while the tab is visible. */
export const TEAM_CHAT_POLL_MS = 8000;

/**
 * Reconcile a `sinceSeq` page's cursor-scoped count with the full thread count.
 * `pending` is the unread remainder reported by the previous forward page.
 * Subtracting it avoids counting the same backlog again on each poll; newly
 * posted messages increase `pageTotal` and therefore the full count. The
 * server counts before fetching rows, so a concurrent post can appear in the
 * page but not its count. The returned rows are the minimum true count.
 */
export function forwardPageCount(
  fullTotal: number,
  pending: number,
  pageTotal: number,
  pageLength: number,
): { total: number; pending: number } {
  const counted = Math.max(pageTotal, pageLength);
  return {
    total: fullTotal + counted - pending,
    pending: counted - pageLength,
  };
}

/**
 * Should the transcript stick to the bottom after an update?
 *
 * A chat scrolls to the newest message — but only for a reader who is already
 * at the bottom. Before #754 the transcript scrolled to the bottom on EVERY
 * change to `messages`, which was harmless because `messages` only changed when
 * the viewer posted (the sole `invalidateAll`) or on navigation. Polling breaks
 * that assumption: the array is replaced every few seconds, so the
 * unconditional scroll would yank a reader out of the history they are reading,
 * on a timer, with no way to stop it.
 *
 * `slack` is the tolerance in px — a reader a line or two off the bottom still
 * counts as "at the bottom", so a fractional scroll offset or a late-loading
 * avatar does not silently strand them.
 */
export function isAtBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number } | null,
  slack = 80,
): boolean {
  // No element yet (first render, SSR) — the sensible default is to stick, so
  // the thread opens on the newest message.
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight <= slack;
}

/**
 * Where to put `scrollTop` after PREPENDING older messages (#793).
 *
 * The inverse of `isAtBottom`, and the half that does not exist yet. Sticking to
 * the bottom keeps a reader at the newest message; this keeps a reader looking
 * at the SAME message when content is inserted above them.
 *
 * A browser measures `scrollTop` from the top of the content, so inserting
 * content above the viewport pushes everything the reader is looking at
 * downwards by exactly the height that was added. Left alone, the view appears
 * to jump backwards the instant a page of history loads — which is precisely
 * the hesitation #793 exists to remove.
 *
 * Call it with the element's metrics captured BEFORE the prepend and its
 * `scrollHeight` AFTER, then assign the result:
 *
 *   const before = { scrollTop: el.scrollTop, scrollHeight: el.scrollHeight };
 *   messages = [...olderPage, ...messages];
 *   await tick();
 *   el.scrollTop = scrollTopAfterPrepend(before, el.scrollHeight);
 *
 * The `await tick()` is load-bearing: `scrollHeight` only reflects the new rows
 * once they are in the DOM, so measuring too early returns the old height and
 * this computes a delta of zero — a no-op that looks exactly like a bug in the
 * arithmetic rather than a mis-timed read.
 */
export function scrollTopAfterPrepend(
  before: { scrollTop: number; scrollHeight: number },
  afterScrollHeight: number,
): number {
  const added = afterScrollHeight - before.scrollHeight;
  // Nothing was added (or the content shrank — a re-render that dropped rows).
  // Restoring a delta here would move a reader who has no reason to move.
  if (added <= 0) return Math.max(0, before.scrollTop);
  return Math.max(0, before.scrollTop + added);
}

/**
 * Union a polled transcript window into the one already on screen (#793).
 *
 * **The poll returns a WINDOW, not the whole thread**. Assigning it wholesale
 * would destroy any history a reader loaded by scrolling back. The component
 * accumulates each bounded forward page into the displayed transcript.
 *
 * So the poll must MERGE. This is
 * `hrn:node:hadronmemory.com:hadron-portal:findings:adding-a-refresh-breaks-what-assumed-user-driven-change`
 * for the third time, and the first where it was predictable from the issue
 * text rather than found in review — which is why the merge is written before
 * the pagination that needs it, rather than after.
 *
 * Identity is `nodeId`, matching the `{#each ... (msg.nodeId)}` key the thread
 * already renders by: two things the runtime treats as the same row must be the
 * same row here, or a merge would produce duplicates Svelte then keys apart.
 * `incoming` wins on a conflict, since it is the fresher read.
 *
 * Ordering is by `seq` — allocated atomically ascending under the chat-root
 * lock (server #939), so it is a total order over a chat and stable under
 * concurrent posting in a way an array index is not.
 *
 * A union never REMOVES, which is right for this data: the team chat is
 * append-only and its messages cannot be deleted through the UI by design
 * (#732). If deletion is ever added, this becomes the wrong shape and the fix
 * is a tombstone in the payload, not a smarter diff here.
 *
 * Returns the EXISTING array by reference when nothing changed. That is not a
 * micro-optimisation: `shownMessages` is `$derived`, and an unchanged reference
 * means the stick-to-bottom effect does not re-run. A poll that found nothing
 * new should be invisible to the reader, including in their scroll position.
 */
export function mergeTranscript(
  existing: readonly TeamChatMessage[],
  incoming: readonly TeamChatMessage[],
): readonly TeamChatMessage[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return [...incoming].sort((a, b) => a.seq - b.seq);

  const byNodeId = new Map(existing.map((m) => [m.nodeId, m]));
  let changed = false;
  for (const msg of incoming) {
    const prev = byNodeId.get(msg.nodeId);
    if (!prev || !sameMessage(prev, msg)) {
      byNodeId.set(msg.nodeId, msg);
      changed = true;
    }
  }
  if (!changed) return existing;
  return [...byNodeId.values()].sort((a, b) => a.seq - b.seq);
}

/**
 * Is this the same message, in every field the thread could render?
 *
 * Compares ALL own keys rather than an enumerated list, and that is the whole
 * point (@copilot on PR #796). The first version checked `body` and `seq` only,
 * which silently ignored `at`, `mentions`, `replyToSeq` and the three author
 * fields — so a server-side change to any of them would return the existing
 * array by reference and the UI would never update.
 *
 * The deeper problem was the SHAPE, not the four missing names: an enumerated
 * equality check is a hand-maintained list that nothing validates against the
 * type it compares, so it goes stale the moment `TeamChatMessage` gains a field
 * — exactly
 * `hrn:node:hadronmemory.com:hadron-portal:review:key-guarding-a-mount-once-child-is-a-dependency-list`,
 * one layer down. Adding the four names would have fixed today's instance and
 * left the mechanism. Iterating the keys means a new field is covered the day
 * it is added, by nobody.
 *
 * Shallow by design: every field on `TeamChatMessage` is a primitive except
 * `mentions`, which is a flat `string[]`. If a nested object is ever added this
 * becomes wrong — and wrong in the quiet direction, reporting "unchanged" for a
 * changed row — so the array branch below is deliberately the only structural
 * case, and anything deeper should fail review rather than be absorbed here.
 */
function sameMessage(a: TeamChatMessage, b: TeamChatMessage): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof TeamChatMessage>;
  for (const key of keys) {
    const av = a[key];
    const bv = b[key];
    if (Array.isArray(av) || Array.isArray(bv)) {
      if (!Array.isArray(av) || !Array.isArray(bv) || av.length !== bv.length) return false;
      if (av.some((item, i) => item !== bv[i])) return false;
      continue;
    }
    if (av !== bv) return false;
  }
  return true;
}
