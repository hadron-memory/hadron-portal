/**
 * An App's installed Agents, as the register's attendee picker needs them.
 *
 * `AppAgent.agent` is nullable: hadron-server#1526 (#1522) returns it only when
 * the caller may read that Agent's definition, and an installation license alone
 * does not grant that read. An App can therefore list an installed vendor Agent
 * it cannot name. Such an Agent is left out of the picker (there is nothing to
 * show), never dereferenced, and never turned into an empty-named option.
 * A register row that already names it still renders by its id.
 */
import { rosterOf } from '$lib/withheld';

export type InstalledAgent = { id: string; name: string; urn: string };

/**
 * portal#1148 (hadron-server#2089): `appAgents` is `null` when the server
 * WITHHOLDS the install roster (an owner-role member of a user-owned App). That
 * is not "no installed agents": it reads as `withheld`, and only a real `[]`
 * is a known-empty roster (lib/withheld.ts).
 */
export type InstalledAgentsRead = { kind: 'ok'; agents: InstalledAgent[] } | { kind: 'withheld' };

export function readableInstalledAgents(
  appAgents: ReadonlyArray<{ agent: InstalledAgent | null }> | null | undefined,
): InstalledAgentsRead {
  const roster = rosterOf(appAgents);
  if (roster.kind === 'withheld') return { kind: 'withheld' };
  return { kind: 'ok', agents: roster.items.flatMap((a) => (a.agent ? [a.agent] : [])) };
}
