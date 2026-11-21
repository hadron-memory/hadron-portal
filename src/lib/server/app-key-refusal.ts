import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import {
  APP_KEY_HOST_CONFLICT_FALLBACK,
  APP_KEY_IMPERSONATION_READ_ONLY,
  APP_KEY_MANAGERS_ONLY,
  APP_KEY_NOT_FOUND_FALLBACK,
} from '$lib/app-key-copy';

/**
 * portal#1068 (hadron-server#1743) — what a refused App-key write tells the
 * reader.
 *
 * Holger, 2026-10-10 (team chat #8095): "whoever manages the App mints,
 * revokes and scopes its App keys" — the App's owner, its owner-role members,
 * the org’s admins and owners, and platform admins
 * (hrn:node:hadronmemory.com:specs:cor:acl:010:01). The
 * SERVER is the gate; the portal never guesses a viewer's role to hide the
 * controls (an App's `role` is its default member role, not the viewer's). So
 * a non-manager learns the rule from the refusal, and this is that refusal.
 *
 * Shared by the App Keys tab's createKey/revokeKey actions and the Client tab's
 * POST /api/create-app-key, so all three say the same thing.
 *
 * The copy is GENERIC on purpose: it names the audience, never the key, and
 * says nothing about whether a key exists.
 *
 * Only known codes are mapped; everything else stays a 500 with the server's
 * own message (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */
// The two sentences live in a client-safe module so the App page can render the
// same words a refused write returns (portal#1153).
export { APP_KEY_MANAGERS_ONLY, APP_KEY_IMPERSONATION_READ_ONLY };

export function appKeyRefusal(e: unknown, fallback: string): { status: 403 | 404 | 409 | 500; text: string } {
  const code = extractGqlErrorCode(e);
  if (code === 'FORBIDDEN') return { status: 403, text: APP_KEY_MANAGERS_ONLY() };
  if (code === 'IMPERSONATION_READ_ONLY') return { status: 403, text: APP_KEY_IMPERSONATION_READ_ONLY() };
  // portal#1487 — the SERVER's own sentence for the two grant answers that
  // are neither an audience refusal nor a fault: a second host (a host key
  // reaches one host) and a key that is gone or was never this App's. Only
  // these known codes map; everything else stays the generic branch
  // (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
  if (code === 'APP_KEY_SCOPE_HOST_CONFLICT') {
    return { status: 409, text: extractGqlError(e, APP_KEY_HOST_CONFLICT_FALLBACK(), ['APP_KEY_SCOPE_HOST_CONFLICT'], { transport: 'fallback' }) };
  }
  if (code === 'APP_KEY_NOT_FOUND') {
    return { status: 404, text: extractGqlError(e, APP_KEY_NOT_FOUND_FALLBACK(), ['APP_KEY_NOT_FOUND'], { transport: 'fallback' }) };
  }
  return { status: 500, text: extractGqlError(e, fallback, [], { transport: 'fallback' }) };
}
