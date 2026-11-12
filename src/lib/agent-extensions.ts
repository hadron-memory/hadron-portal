import type { AgentExtensions, AgentIdentity } from '$lib/server/agent-profile';

/** Client deadline for one Retry re-read (#1560 review). The endpoint bounds
 *  its own upstream read (the optional-list bound, 8 s); this bounds the
 *  browser's leg — fetch and body read — so a stalled connection re-arms the
 *  alert and the Retry control instead of wedging the section in "Retrying…".
 *  Lives here, client-safe, beside the parser the retry shares with it. */
export const RETRY_TIMEOUT_MS = 12_000;

// #1503: the client-side guard for a section-owned re-read payload. A Retry
// answer is rendered into the page, so it is REFUSED unless every field is
// well-formed — anything malformed is a failed read, never partial garbage.
// Type-only import above: this module is client code and must never pull the
// server module at runtime. Keep the validation set in sync with the
// AgentExtensions interface ($lib/server/agent-profile.ts).
export function parseExtensions(payload: unknown): AgentExtensions | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Record<string, unknown>;
  if (!Array.isArray(p.items)
    || !p.items.every((it): it is AgentIdentity =>
      typeof it === 'object' && it !== null
      && typeof (it as Record<string, unknown>).id === 'string'
      && typeof (it as Record<string, unknown>).name === 'string'
      && typeof (it as Record<string, unknown>).urn === 'string')
    || typeof p.hasMore !== 'boolean'
    || (p.endCursor !== null && typeof p.endCursor !== 'string')
    || typeof p.failed !== 'boolean') return null;
  return { items: p.items, endCursor: p.endCursor as string | null, hasMore: p.hasMore, failed: p.failed };
}
