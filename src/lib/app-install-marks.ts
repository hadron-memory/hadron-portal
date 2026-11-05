/**
 * portal#1684 (hadron-server#3435): how an App installs each Agent, keyed by
 * agent id, read only from what the server states.
 */
export type InstallImporter = { id: string; name: string; urn: string };
export type InstallMark = { kind: 'installed' } | { kind: 'derived'; importer: InstallImporter };
export type InstallMarks = Record<string, InstallMark>;
export type AppAgentInstall = {
  agent: { id: string } | null;
  installMethod: 'ROW' | 'DERIVED' | null;
  importer: InstallImporter | null;
};

export function installMarksOf(_appAgents: ReadonlyArray<AppAgentInstall> | null | undefined): InstallMarks {
  return {};
}
