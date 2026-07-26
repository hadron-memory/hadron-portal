// #647: the caller's own (org-less, user-owned) apps — the app analogue of
// personal-memories / personal-agents, backing the "My apps" surface.
//
// #782 (server): scoped SERVER-side via MY_APPS_QUERY's filter.ownedByMe
// (organizationId IS NULL AND ownerUserId = caller, no admin bypass), replacing
// the client-side organizationId==null filter that made an admin fetch every app
// system-wide.
import { gqlClient } from './api';
import { fetchAllItems } from './paginate';
import { MY_APPS_QUERY } from './queries';

/** One org-less app as the "My apps" list renders it. */
export interface PersonalApp {
  id: string;
  urn: string;
  name: string;
  description: string | null;
  organizationId: string | null;
  appType: string;
  agentId: string | null;
  agent: { id: string; urn: string; name: string } | null;
}

/** Throws on query failure — callers decide how to surface it. */
export async function fetchOwnedApps(token: string | null): Promise<PersonalApp[]> {
  return fetchAllItems<PersonalApp>(gqlClient(token), MY_APPS_QUERY, 'apps');
}
