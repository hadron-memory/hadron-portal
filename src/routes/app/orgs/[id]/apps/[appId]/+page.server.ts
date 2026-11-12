// #648: the canonical App detail moved to the org-optional /app/apps/[appId]
// (it resolves both org-owned and user-owned apps). This org-scoped route is now
// a navigation alias only — redirect to the canonical page, mirroring
// /app/orgs/[id]/agents/[aid] → /app/agents/[aid] (spec 018). The canonical
// loader resolves the app (and its org chrome) on its own, so no org hint is
// needed.
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, parent }) => {
  // #1732: wait for the app layout (it writes the active-org cookie) first.
  await parent();
  redirect(303, `/app/apps/${params.appId}`);
};
