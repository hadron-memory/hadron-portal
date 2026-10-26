/**
 * #1032 — which installed agents the "Cast a worker" Agent field offers, and in
 * what order.
 *
 * Only agents that carry a persona role. An agent without one is the App's own
 * team agent (e.g. "Hadron Dev Team"), not a role a worker is cast into.
 * R222 requires a role-bearing Agent; the server enforces the same requirement.
 *
 * Sorted by name, case-insensitively, because the install roster arrives in
 * install order and a larger team's list was unscannable.
 */
export type CastableAgent = { id: string; name: string; personaRole?: string | null };

export function castableAgentOptions<T extends CastableAgent>(installed: readonly T[]): T[] {
  return installed
    .filter((agent) => !!agent.personaRole?.trim())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}
