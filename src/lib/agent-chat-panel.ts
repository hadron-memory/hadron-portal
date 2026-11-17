/**
 * The App page's Agent chat panel height (portal#740, #2201). `dvh` tracks the
 * visible viewport; the `vh` line before it is the fallback for browsers
 * without `dvh`. Shared with scripts/test-agent-chat-transcript-floor.mjs so
 * the browser probe measures the formula the page ships, not a copy of it.
 */
export const AGENT_CHAT_PANEL_STYLE = 'height: calc(100vh - 280px); height: calc(100dvh - 280px);';
