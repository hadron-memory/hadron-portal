import type { AgentExtensions, AgentIdentity } from '$lib/server/agent-profile';

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
