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
