export interface AgentOrigin { agentId: string; agentUrn: string }
export interface DefinitionEntry {
  node: { id: string; memoryId: string; loc: string; name: string; urn: string; inheritedFrom: AgentOrigin | null };
  trigger: string | null;
  kind?: 'STARTS' | 'INVOLVED';
}
export interface DefinitionRead { items: DefinitionEntry[] | null; error: string | null }
export interface AgentBaseRead {
  id: string | null;
  agent: { id: string; name: string; urn: string } | null;
  error: string | null;
}
export function definitionHref(agentId: string, loc: string): string {
  return `/app/agents/${encodeURIComponent(agentId)}/definitions/${encodeURIComponent(loc)}`;
}

export function definitionEntryHref(agentId: string, entry: DefinitionEntry): string {
  return entry.node.inheritedFrom
    ? definitionHref(agentId, entry.node.loc)
    : `/app/memories/${encodeURIComponent(entry.node.memoryId)}/nodes/${encodeURIComponent(entry.node.id)}`;
}
