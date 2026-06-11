// graphql-request packs the entire request/response payload (query, variables,
// stack) into `Error.message`. Returning that to the client both leaks internal
// detail and produces unreadable UI errors. Prefer the server's first GraphQL
// error message; fall back to the raw message, then a caller-supplied default.
export function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    // `response` can be null/undefined on transport errors even though the
    // `'response' in e` check passes — optional-chain before reading errors.
    const resp = (e as { response?: { errors?: { message: string }[] } }).response;
    if (resp?.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}
