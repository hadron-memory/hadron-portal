// Shared error mapping for the /api/assets/* proxy endpoints.
//
// These endpoints answer JSON (`{ code, message }`) rather than throwing
// SvelteKit `error()`, because their callers are the client helpers in
// $lib/api/assetUpload.ts, which surface `code` to the UI. The rule from
// review:clienterror-map-known-codes-only still applies, restated for a JSON
// endpoint: map only KNOWN extensions.code values to a 4xx, and let everything
// else — an unknown code, INTERNAL_SERVER_ERROR, a transport failure with no
// GraphQL errors payload at all — come out as a 500.
//
// Each of the five original endpoints hand-rolled its own mapping with a
// catch-all `→ 400` tail. That turned a resolver crash and a dead gateway into
// "your request was bad", which is both wrong and unactionable.

import { ClientError } from 'graphql-request';
import { LOC_CONFLICT_CODE } from '$lib/assets/error-codes';

/**
 * Codes hadron-server actually emits on the asset surface, each with the status
 * it should become. Anything absent here is NOT a client fault.
 *
 * NOT_FOUND covers no-access too, by design: #888 made an unreadable asset
 * report NOT_FOUND rather than a distinguishable PERMISSION_DENIED, closing an
 * existence oracle over asset ids. PERMISSION_DENIED stays mapped because the
 * write paths (upload, reference-node, delete) still emit it.
 */
const KNOWN: Record<string, number> = {
  UNAUTHENTICATED: 401,
  SESSION_EXPIRED: 401,
  PERMISSION_DENIED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  NODE_NOT_FOUND: 404,
  // Scan gates: the asset exists and the caller may read it, but the bytes are
  // not releasable yet (PENDING) or ever (BLOCKED). 409, not 400 — nothing about
  // the request was malformed.
  SCAN_PENDING: 409,
  SCAN_BLOCKED: 409,
  // Genuine client faults.
  BAD_USER_INPUT: 400,
  GRAPHQL_VALIDATION_FAILED: 400,
  INVALID_INPUT: 400,
  SIZE_EXCEEDED: 400,
  MIME_NOT_ALLOWED: 400,
  MEMORY_NOT_ACCEPTING_UPLOADS: 400,
  URN_NOT_QUALIFIED: 400,
  // Reference-node writes go through writeNodeCore in 'create' mode, which
  // reports collisions and bad locs by throwing typed errors whose
  // `extensions.code` is the CLASS NAME, not a SCREAMING_CASE constant. An
  // earlier draft here guessed `LOC_CONFLICT`, which matches nothing — so an
  // attach onto an occupied loc surfaced as an opaque 500 "the server had a
  // problem" instead of the 409 the dialog now retries on.
  [LOC_CONFLICT_CODE]: 409,
  InvalidLocError: 400,
};

export interface AssetErrorBody {
  code: string;
  message: string;
}

/**
 * Map a caught error to a JSON body + status.
 *
 * `context` names the operation for the server-side log line, which is the only
 * place an unmapped failure's detail survives — the client is told just
 * "INTERNAL", so the cause has to be recoverable from the logs.
 */
export function mapAssetError(
  err: unknown,
  context: string,
): [AssetErrorBody, { status: number }] {
  // A ClientError with no `errors` payload is a TRANSPORT failure (bad gateway,
  // HTML error body), not a GraphQL rejection — reading extensions.code off it
  // yields undefined, and a catch-all would turn an outage into a false 4xx.
  if (err instanceof ClientError && err.response?.errors?.length) {
    const first = err.response.errors[0];
    const code = (first.extensions as { code?: string } | undefined)?.code;
    const status = code ? KNOWN[code] : undefined;
    if (code && status) {
      return [{ code, message: first.message ?? 'asset request failed' }, { status }];
    }
    console.error(`[assets] ${context}: unmapped GraphQL error`, code ?? '(no code)', first.message);
    return [{ code: 'INTERNAL', message: 'the server had a problem' }, { status: 500 }];
  }
  console.error(`[assets] ${context}:`, err);
  return [{ code: 'INTERNAL', message: 'the server had a problem' }, { status: 500 }];
}
