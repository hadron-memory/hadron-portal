import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Spec 018: redirect to the canonical detail page and carry the owning
// org id as a hint, so the loader can org-scope its agent lookup
// without re-deriving the org via a cross-org myOrganizations scan.
export const load: PageServerLoad = async ({ params }) => {
  redirect(303, `/app/agents/${params.aid}?org=${params.id}`);
};
