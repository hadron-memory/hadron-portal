/**
 * The App page's Agent chat panel height (portal#740, #2201). `dvh` tracks the
 * visible viewport; the `vh` line before it is the fallback for browsers
 * without `dvh`. The `min-height` floor (30rem = 480px) is what keeps the
 * transcript readable on short phones: the header, AI row and composer take
 * about 285px of a `100dvh - 280px` panel, so at 320x568 the transcript got 0px.
 * Below the floor the page scrolls instead of the transcript shrinking.
 * Shared with scripts/test-agent-chat-transcript-floor.mjs so the browser probe
 * measures the formula the page ships, not a copy of it.
 */
export const AGENT_CHAT_PANEL_STYLE = 'height: calc(100vh - 280px); height: calc(100dvh - 280px); min-height: 30rem;';
