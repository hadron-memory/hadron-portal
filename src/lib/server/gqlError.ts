// graphql-request packs the entire request/response payload (query, variables,
// stack) into a ClientError's `Error.message`. Returning that to the client
// leaks internal detail and is unreadable, so prefer the server's first GraphQL
// error message (`response.errors[0].message`) — that's the #468 fix for the
// query/variable leak. Fall back to the raw message for non-GraphQL (transport)
// errors — callers/tests rely on it for message-based branching — then a
// caller-supplied default.
export function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    // `response` can be null/undefined on transport errors even though the
    // `'response' in e` check passes — optional-chain before reading errors.
    const resp = (e as { response?: { errors?: { message: string }[] } }).response;
    if (resp?.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

/**
 * Like `extractGqlError`, but NEVER falls back to `Error.message` (#873).
 *
 * `extractGqlError`'s transport fallback is the whole problem for an action
 * that carries a secret. graphql-request packs the request — **including the
 * variables** — into a ClientError's `Error.message`, so on a transport failure
 * (a 502, a dropped connection) that fallback returns the submitted passphrase
 * or data key straight into `form.message.text`, which is sent to the client.
 * Scrubbing `form.data` does not help: this is a different field on the same
 * response.
 *
 * So: the server's own GraphQL message when there is one — those are written by
 * us and name the rule that refused — and the caller's generic fallback
 * otherwise. A transport failure loses its detail here, which is the point; it
 * is already in the server log, where the user's key is not.
 *
 * Use this for any action whose form data includes something the user would not
 * want echoed. Found by @copilot on #884, on the catch path of the first action
 * in this repo to handle a secret.
 */
export function extractGqlErrorNoEcho(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response?: { errors?: { message: string }[] } }).response;
    if (resp?.errors?.[0]?.message) return resp.errors[0].message;
  }
  return fallback;
}

// The server tags GraphQL errors with `extensions.code` (FORBIDDEN, NOT_FOUND,
// URN_NOT_QUALIFIED, …). Pull the first one out so callers can branch on it.
// Returns null on transport errors / non-GraphQL errors (no response payload).
export function extractGqlErrorCode(e: unknown): string | null {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response?: { errors?: { extensions?: { code?: string } }[] } }).response;
    return resp?.errors?.[0]?.extensions?.code ?? null;
  }
  return null;
}
