// Spec 014 US4: /app/dashboard is now a 302 redirector to the active-org's
// scoped equivalent. The cross-org dashboard rendering (myMemories +
// myApps aggregate) is removed per D-2026-05-03-004; the rendered
// dashboard lives at /app/orgs/<active>/.
//
// Resolution chain (URL → lastActiveOrgId → personal) runs in the
// layout (R-1, R-6) and the resolved activeOrgId is read here via
// `await parent()`. See contracts/portal-redirector-chain.md.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { activeOrgId } = await parent();
  if (!activeOrgId) redirect(303, '/app/orgs/');
  redirect(302, `/app/orgs/${activeOrgId}/`);
};
