import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { APP_KEY_MANAGERS_ONLY, APP_KEY_IMPERSONATION_READ_ONLY } from '$lib/app-key-copy';

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

export function appKeyRefusal(e: unknown, fallback: string): { status: 403 | 500; text: string } {
  const code = extractGqlErrorCode(e);
  if (code === 'FORBIDDEN') return { status: 403, text: APP_KEY_MANAGERS_ONLY() };
  if (code === 'IMPERSONATION_READ_ONLY') return { status: 403, text: APP_KEY_IMPERSONATION_READ_ONLY() };
  return { status: 500, text: extractGqlError(e, fallback) };
}
