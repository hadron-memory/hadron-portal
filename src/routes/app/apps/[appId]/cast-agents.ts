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

export type CastGroups<T> = { installed: T[]; derived: Array<{ agent: T; importer: InstallImporter }> };

export function castGroups<T extends CastableAgent>(options: readonly T[], _marks: InstallMarks): CastGroups<T> {
  return { installed: [...options], derived: [] };
}
