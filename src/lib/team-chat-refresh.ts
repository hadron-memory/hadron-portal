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
