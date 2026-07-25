// 009-install-agent-flow T020: an App is created by INSTALLING an Agent — there
// is no bare "create app" form. Today the only wired install path is org-scoped
// (`/app/orgs/[id]/agents/install/[aid]`), so this route redirects to the org
// list to pick an org and install one of its Agents.
//
// NOTE (#647): this is NOT the whole story. Spec 047 also supports ORG-LESS
// (user-owned) apps — `createApp` with no `orgId` installs a PUBLIC or the
// caller's OWN personal agent as a personal App (server
// resolvers.mutation.app.ts). The portal just hasn't wired that org-less install
// path yet; until it does, an individual (org-less) user reaching here is still
// bounced to the org list, which is a dead end for them. Wiring the org-less
// create/install flow (and the org-less `/app/apps/[appId]` detail) is the #647
// follow-up. Do not read this redirect as "org-less apps don't exist" — they do.
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
