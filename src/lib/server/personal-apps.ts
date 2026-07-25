// #647: the caller's own (org-less, user-owned) apps — the app analogue of
// personal-memories / personal-agents. The server's default apps() list (no
// orgId) returns the caller's user-owned apps (organizationId NULL,
// ownerUserId=caller) alongside their org apps; keep only the org-less ones for
// the "My apps" surface.
//
// INTERIM: filters client-side; for a platform ADMIN the default apps() list
// returns every org app system-wide, so this over-fetches. Server-side
// "owned by me / org-less" filter tracked in hadron-server#782 — switch when it
// lands. No behavior change for a normal individual.
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
  const apps = await fetchAllItems<PersonalApp>(gqlClient(token), MY_APPS_QUERY, 'apps');
  return apps.filter((a) => a.organizationId == null);
}
