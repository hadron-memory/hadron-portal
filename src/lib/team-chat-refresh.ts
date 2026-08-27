/**
 * The invalidation key the App page's team chat refreshes on (#754).
 *
 * Shared between the page loader (`depends(TEAM_CHAT_DEP)`) and the poller
 * (`invalidate(TEAM_CHAT_DEP)`) so the two cannot drift on its spelling — a
 * typo on either side is silent: `invalidate` on an unknown key re-runs
 * nothing, and the thread would simply never refresh.
 *
 * Why a key rather than `invalidateAll()`: the App page's load is a six-query
 * parallel fetch (including `appNodes` at limit 500), and `invalidateAll` would
 * additionally re-run every parent layout load. `invalidate(key)` re-runs only
 * the loads that declared that dependency — here, just this page's.
 */
export const TEAM_CHAT_DEP = 'hadron:app:team-chat';

/** How often the thread refetches while the tab is visible. */
export const TEAM_CHAT_POLL_MS = 8000;

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
 * What a poll should put back in the composer after a refetch, or `null` for
 * "leave it alone".
 *
 * A refresh re-runs the page load, superForm re-syncs from the fresh form, and
 * an unsent draft goes with it. Restoring it is right — but only sometimes, and
 * the cases are not symmetric (#784).
 *
 * It takes the LATEST value the user caused, not a snapshot taken when the
 * refetch began. An epoch-style "did anything change?" guard is not enough:
 * typing during the await changes it too, and refusing on that basis loses BOTH
 * the snapshot and the character they just typed (Codex P1). The three signals
 * that actually matter:
 *
 *   - `lastUserBody` — what the reader last typed, `''` if they cleared it.
 *     Empty is meaningful: it says "I want this box empty", so nothing is put
 *     back.
 *   - `postedDuringRefresh` — a post completed in the window and `resetForm`
 *     cleared the body it had just SENT. Restoring would re-arm a message the
 *     team has already seen, one Enter from a duplicate. This is the case that
 *     makes the whole helper worth having.
 *   - `currentBody` — anything already there wins; never stomp it.
 */
export function restoredDraft(args: {
  /** The latest value the USER caused — `''` when they deliberately cleared it. */
  lastUserBody: string;
  /** Did a successful post land while the refetch was in flight? */
  postedDuringRefresh: boolean;
  /** The composer's body now, after the refresh. */
  currentBody: string;
}): string | null {
  if (args.postedDuringRefresh) return null; // it was sent, not lost
  if (!args.lastUserBody) return null; // they cleared it, or never typed
  if (args.currentBody) return null; // something is already there
  return args.lastUserBody;
}
