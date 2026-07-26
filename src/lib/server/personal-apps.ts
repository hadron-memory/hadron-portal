// #647: the caller's own (org-less, user-owned) apps — the app analogue of
// personal-memories / personal-agents. MY_APPS_QUERY scopes the list
// SERVER-SIDE via `filter: { ownedByMe: true }` (hadron-server #782/#787 — new
// AppFilter input): it returns only the caller's user-owned apps (organizationId
// NULL, ownerUserId=caller) for ALL callers — including platform admins — so no
// client-side org-less post-filter is needed here.
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
