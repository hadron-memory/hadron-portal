/**
 * #1043 — the memories an App can reach, for the App page's summaries.
 *
 * Built from EVERY installed Agent (`App.agents`), not `App.agent`, which is
 * only the first one (`hrn:node:hadronmemory.com:hadron-portal:findings:app-agent-is-only-the-first-agent`).
 * On a team App the first Agent is usually the role-less team agent, so
 * reading it alone under-listed the App's memories and marked a role agent's
 * writable memory read-only by omission.
 *
 * The fold mirrors the server's App memory access (`getAppMemoryAccess` with
 * `allAgents`, which `appNodes` uses): read-write from any Agent wins, and the
 * App's team space joins as read, the level that fold gives it. The server
 * still decides each write.
 */
import type { App } from '$lib/types';

export interface EffectiveMemory {
  id: string;
  urn: string;
  name: string;
  access: 'read' | 'read-write';
  /** The Agent that grants this access, or the team-space label. */
  agentName: string;
}

type AppMemorySource = Pick<App, 'agent' | 'agents' | 'sharedMemory'>;

export function effectiveAppMemories(app: AppMemorySource, teamSpaceLabel: string): EffectiveMemory[] {
  const map = new Map<string, EffectiveMemory>();
  // `agents` is the full install roster; `agent` is kept as a fallback for a
  // payload that predates the roster's memoryItems selection.
  const agents = app.agents?.length ? app.agents : app.agent ? [app.agent] : [];
  for (const agent of agents) {
    for (const item of agent.memoryItems ?? []) {
      const access = item.role === 'read-write' ? ('read-write' as const) : ('read' as const);
      const prior = map.get(item.memory.id);
      if (prior && (prior.access === 'read-write' || access === 'read')) continue;
      map.set(item.memory.id, {
        id: item.memory.id, urn: item.memory.urn, name: item.memory.name,
        access, agentName: agent.name,
      });
    }
  }
  const shared = app.sharedMemory;
  if (shared && !map.has(shared.id)) {
    map.set(shared.id, {
      id: shared.id, urn: shared.urn, name: shared.name, access: 'read', agentName: teamSpaceLabel,
    });
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}
