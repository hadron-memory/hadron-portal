/**
 * #1032 — which installed agents the "Cast a worker" Agent field offers, and in
 * what order.
 *
 * Only Agents that carry a persona role are offered here. This leaves out
 * roleless Agents such as an App's team definition.
 * This is the portal's picker policy. At server53e12896 a cast can retain a
 * null role; changeWorkerAgent has the separate no-role refusal. Do not infer
 * either server write's rules from the options offered here.
 *
 * Sorted by name, case-insensitively, because the install roster arrives in
 * install order and a larger team's list was unscannable.
 */
import type { InstallImporter, InstallMarks } from '$lib/app-install-marks';

export type CastableAgent = { id: string; name: string; personaRole?: string | null };

export function castableAgentOptions<T extends CastableAgent>(installed: readonly T[]): T[] {
  return installed
    .filter((agent) => !!agent.personaRole?.trim())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id));
}

/**
 * #1684, ruling 0141: an installed agent is preferred over a derived one. The
 * form offers both, since a cast names its agent, with the installed ones first.
 * An agent with no mark stays with the installed ones: only the server's
 * DERIVED moves it, so a withheld answer leaves the plain list.
 */
export type CastGroups<T> = { installed: T[]; derived: Array<{ agent: T; importer: InstallImporter }> };

export function castGroups<T extends CastableAgent>(options: readonly T[], marks: InstallMarks): CastGroups<T> {
  const groups: CastGroups<T> = { installed: [], derived: [] };
  for (const agent of options) {
    const mark = marks[agent.id];
    if (mark?.kind === 'derived') groups.derived.push({ agent, importer: mark.importer });
    else groups.installed.push(agent);
  }
  return groups;
}
