import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Spec 018: redirect to the canonical agent detail page. Per D-1 in
// plan.md, the org-scoped variant is a navigation alias only — the
// canonical loader resolves the agent across all the user's orgs, so
// no `?org=<id>` hint is needed (and an earlier strict-pivot version
// was explicitly removed to avoid false 404s on cross-org navigation).
export const load: PageServerLoad = async ({ params, parent }) => {
  // #1732: wait for the app layout (it writes the active-org cookie) first.
  await parent();
  redirect(303, `/app/agents/${params.aid}`);
};
