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
export type InstalledAgent = { id: string; name: string; urn: string };

export function readableInstalledAgents(
  appAgents: ReadonlyArray<{ agent: InstalledAgent | null }> | null | undefined,
): InstalledAgent[] {
  return (appAgents ?? []).flatMap((a) => (a.agent ? [a.agent] : []));
}
