/**
 * The server's own deadline for one AI-config respond test (#2042): the abort
 * the user must be able to see (#2054). This is a leaf module with no imports
 * on purpose: the server's LLM client and the client's readback helper share
 * the one value without dragging i18n tables or provider lists across the
 * `$lib/server` line.
 */
export const AI_CONFIG_TEST_DEADLINE_MS = 20_000;

/**
 * The client's headroom over that deadline when deriving the respond-test
 * window: it must cover what the server does outside the deadline's own
 * AbortSignal.timeout (the handler's pre-LLM work, response serialization)
 * plus transport, so the client still never aborts first. It is not a tight
 * bound; the pins hold it at no less than 5 s so it cannot shrink silently.
 */
export const AI_CONFIG_TEST_MARGIN_MS = 5_000;
