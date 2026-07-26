// #647: the caller's own (org-less, user-owned) agents — the agent analogue of
// personal-memories. MY_AGENTS_QUERY scopes the list SERVER-SIDE via
// `filter: { ownedByMe: true }` (hadron-server #782/#787): it returns only the
// caller's user-owned agents (organizationId NULL, ownerUserId=caller) for ALL
// callers — including platform admins — so no client-side org-less post-filter
// is needed here.
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
  return fetchAllItems<PersonalAgent>(gqlClient(token), MY_AGENTS_QUERY, 'agents');
}
