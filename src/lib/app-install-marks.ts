/**
 * portal#1684 (hadron-server#3435): how an App installs each Agent, keyed by
 * agent id, read only from what the server states.
 *
 * `installMethod` answers only when the caller may read every Agent in the App.
 * Otherwise it is null on every entry, physical rows included, so null is not
 * "installed" and nothing here works a mark out from another field. An agent
 * with no mark draws none.
 */
export type InstallImporter = { id: string; name: string; urn: string };
export type InstallMark = { kind: 'installed' } | { kind: 'derived'; importer: InstallImporter };
export type InstallMarks = Record<string, InstallMark>;
export type AppAgentInstall = {
  agent: { id: string } | null;
  installMethod: 'ROW' | 'DERIVED' | null;
  importer: InstallImporter | null;
};

export function installMarksOf(appAgents: ReadonlyArray<AppAgentInstall> | null | undefined): InstallMarks {
  const marks: InstallMarks = {};
  for (const row of appAgents ?? []) {
    if (!row.agent) continue;
    if (row.installMethod === 'ROW') marks[row.agent.id] = { kind: 'installed' };
    else if (row.installMethod === 'DERIVED' && row.importer) marks[row.agent.id] = { kind: 'derived', importer: row.importer };
  }
  return marks;
}
