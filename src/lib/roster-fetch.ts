/**
 * The client's own bound on the AI Team roster read (portal#2310). It lives in a
 * small shared module, away from `$lib/server/*`, so the page and its client
 * test can both name it. It must stay above the endpoint's own bound,
 * `OPTIONAL_LIST_TIMEOUT_MS` (`$lib/server/with-timeout`, used by
 * `roster/+server.ts`), or the client gives up on an answer the server is
 * still entitled to send; `roster-critical-path.test.ts` pins that margin.
 */
export const ROSTER_FETCH_TIMEOUT_MS = 10_000;
