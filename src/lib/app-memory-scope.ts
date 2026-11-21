/** Authorized leaf projection, hrn:node:hadronmemory.com:specs:cor:dmo:050:17. */
export interface AppScopedMemory {
  memoryId: string;
  memoryUrn: string;
  name: string;
  class: string;
  viewerCanWrite: boolean;
  sources: { kind: string; agentId: string | null }[];
}

/** Advisory create targets only; the server still decides each write. */
export function appMemoryTargets(rows: readonly AppScopedMemory[]): string[] {
  return rows.filter(row => row.viewerCanWrite === true && row.sources.some(source => source.kind !== 'INHERITED_BASE'))
    .map(row => row.memoryId);
}
