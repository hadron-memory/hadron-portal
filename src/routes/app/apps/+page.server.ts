// Spec 014: /app/apps is now a 302 redirector to the active-org's
// scoped variant. See spec FR-008 and contracts/portal-redirector-chain.md.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ parent }) => {
  const { activeOrgId } = await parent();
  if (!activeOrgId) redirect(303, '/app/orgs/');
  redirect(302, `/app/orgs/${activeOrgId}/apps`);
};
