// #647: the caller's own (org-less, user-owned) agents — the agent analogue of
// personal-memories, backing the "My agents" surface.
//
// #782 (server): the scoping is now SERVER-side — MY_AGENTS_QUERY passes
// filter.ownedByMe, so the list is already exactly organizationId IS NULL AND
// ownerUserId = caller, for every caller including a platform admin. The former
// client-side organizationId==null filter is gone: for an admin it pulled EVERY
// agent system-wide (dragging each one's relations through resolution) only to
// discard nearly all of them.
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
