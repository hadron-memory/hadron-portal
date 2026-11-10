import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { PUBLIC_ORGANIZATION_PROFILE_QUERY } from '$lib/server/queries';
import type { PublicOrganization } from '$lib/types';
import type { PageServerLoad } from './$types';

/**
 * #1846 slice B — a signed-in non-member's sanitized organization profile.
 * `params.id` is a server ref (id or URN). The server's discoverability gate
 * returns null for missing and non-discoverable organizations alike. Transport
 * and GraphQL failures deliberately propagate as 500s, never false 404s.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  const { publicOrganization } = await gqlClient(locals.token).request<{
    publicOrganization: PublicOrganization | null;
  }>(PUBLIC_ORGANIZATION_PROFILE_QUERY, { ref: params.id });

  if (!publicOrganization) {
    throw error(404, 'Organization not found');
  }

  return { organization: publicOrganization };
};
