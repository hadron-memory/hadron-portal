/**
 * #1032 — which installed agents the "Cast a worker" Agent field offers, and in
 * what order.
 *
 * Only agents that carry a persona role. An agent without one is the App's own
 * team agent (e.g. "Hadron Dev Team"), not a role a worker is cast into, and
 * listing it beside the role agents invited exactly that miscast. This narrows
 * the picker deliberately, per
 * hrn:node:hadronmemory.com:hadron-portal:review:derived-options-are-suggestions:
 * the server's `castWorker` still accepts such an agent, so the capability is
 * not gone, only no longer offered here — the CLI and MCP surfaces keep it.
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
