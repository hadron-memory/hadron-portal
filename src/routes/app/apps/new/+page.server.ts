// 009-install-agent-flow T020: the legacy global "create app" route is
// retired. Apps are now created exclusively by installing an Agent (FR-004).
// Redirect any incoming hit to the org list so the user can pick an org and
// install one of its Agents. Both GETs and stale POSTs (e.g., a cached
// form resubmission from before the deploy) follow the redirect.
import { redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
  throw redirect(308, '/app/orgs');
};

export const actions: Actions = {
  default: async () => {
    throw redirect(303, '/app/orgs');
  },
};
