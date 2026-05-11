// Spec 014: /app/agents is now a 302 redirector to the active-org's
// scoped variant. See spec FR-008 and contracts/portal-redirector-chain.md.
//
// The original cross-org rendering (a flat list of agents across every
// org the user belongs to) is removed per D-2026-05-03-004 "drop top-
// level cross-org list views". The URL stays valid; only the rendering
// is delegated to /app/orgs/<active>/agents.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { activeOrgId } = await parent();
  if (!activeOrgId) redirect(303, '/app/orgs/');
  redirect(302, `/app/orgs/${activeOrgId}/agents`);
};
