// Shared error mapping for the /api/assets/* proxy endpoints.
//
// These endpoints answer JSON (`{ code, message }`) rather than throwing
// SvelteKit `error()`, because their callers are the client helpers in
// $lib/api/assetUpload.ts, which surface `code` to the UI. The rule from
// hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only still applies, restated for a JSON
// endpoint: map only KNOWN extensions.code values to a 4xx, and let everything
// else — an unknown code, INTERNAL_SERVER_ERROR, a transport failure with no
// GraphQL errors payload at all — come out as a 500.
//
// Each of the five original endpoints hand-rolled its own mapping with a
// catch-all `→ 400` tail. That turned a resolver crash and a dead gateway into
// "your request was bad", which is both wrong and unactionable.

import { ClientError } from 'graphql-request';
import { LOC_CONFLICT_CODE } from '$lib/assets/error-codes';
import { lookupOwn } from '$lib/lookup';
import { limitRefusal } from '$lib/server/limit-refusal';

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
  // #707 — the upload-side scan verdict, and the reason that issue's first part
  // sat open for a month. `completeAssetUpload` throws this when the inline scan
  // returns BLOCKED, and it was MISSING here: the code fell to the catch-all and
  // a user who uploaded an infected file was told "the server had a problem".
  // A verdict about their file, reported as our outage — the exact thing
  // hadron-server#924 stopped being unavoidable.
  //
  // 409 rather than 400, joining the scan family above: nothing about the
  // request was malformed, and the distinction a caller acts on is carried by
  // the CODE, not the status.
  MALWARE_BLOCKED: 409,
  // Found by diffing this table against every `new AssetUploadError(...)` in
  // hadron-server rather than against the issue's list — both of these reach
  // portal endpoints (`complete` and `download`; `begin` and `list`) and both
  // were landing as 500s.
  //
  // `restoreAsset`'s two codes (ASSET_BYTES_GONE, ASSET_NOT_DELETED) are
  // deliberately still absent: the portal has no restore path, so mapping them
  // would be a claim about a surface that does not exist here.
  MEMORY_ENCRYPTED_NO_KEY: 409,
  // #2569 (C3): an owner at a limit (file bytes, or nodes for the reference node) and a node over the
  // size ceiling. The server's message is forwarded below; the client falls back to it for a code it has no copy for.
  OWNER_LIMIT_REACHED: 409,
  NODE_CONTENT_TOO_LARGE: 400,
  TOOL_NOT_ENABLED: 403,
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
  /** #2569: a link an installed extension offers beside an OWNER_LIMIT_REACHED message. */
  action?: { label: string; href: string };
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
    // #835 — `lookupOwn`, not `KNOWN[code]`. `code` comes off the wire, and an
    // inherited key makes `status` a FUNCTION that passes the truthiness guard
    // below; `json(body, { status })` then throws on a non-numeric status,
    // turning an unmapped code into a crash instead of the clean 500 the
    // `console.error` path underneath is written to produce.
    const status = lookupOwn(KNOWN, code);
    if (code && status) {
      const action = limitRefusal(err)?.action;
      return [{ code, message: first.message ?? 'asset request failed', ...(action ? { action } : {}) }, { status }];
    }
    console.error(`[assets] ${context}: unmapped GraphQL error`, code ?? '(no code)', first.message);
    return [{ code: 'INTERNAL', message: 'the server had a problem' }, { status: 500 }];
  }
  console.error(`[assets] ${context}:`, err);
  return [{ code: 'INTERNAL', message: 'the server had a problem' }, { status: 500 }];
}
