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
