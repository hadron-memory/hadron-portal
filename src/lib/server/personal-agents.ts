// #647: the caller's own (org-less, user-owned) agents — the agent analogue of
// personal-memories. The server's default agents() list (no orgId) returns the
// caller's user-owned agents (organizationId NULL, ownerUserId=caller) alongside
// their org agents; keep only the org-less ones for the "My agents" surface.
//
// INTERIM: this filters client-side. For a platform ADMIN the default agents()
// list returns EVERY org agent system-wide (not just the caller's), so this
// over-fetches and drags every org agent's relations through resolution. A
// server-side "owned by me / org-less" filter is tracked in hadron-server#782;
// switch to it when it lands (also fixes the dashboard Agent Stats count for
// admins). No behavior change for a normal individual (they only have their own).
import { gqlClient } from './api';
import { fetchAllItems } from './paginate';
import { MY_AGENTS_QUERY } from './queries';

/** One org-less agent as the "My agents" list renders it. */
export interface PersonalAgent {
  id: string;
  urn: string;
  name: string;
  description: string | null;
  visibility: 'PUBLIC' | 'ORGANIZATION' | 'PERSONAL';
  organizationId: string | null;
  systemMemoryId: string | null;
  memoryItems: Array<{ id: string }>;
}

/** Throws on query failure — callers decide how to surface it. */
export async function fetchOwnedAgents(token: string | null): Promise<PersonalAgent[]> {
  const agents = await fetchAllItems<PersonalAgent>(gqlClient(token), MY_AGENTS_QUERY, 'agents');
  return agents.filter((a) => a.organizationId == null);
}
