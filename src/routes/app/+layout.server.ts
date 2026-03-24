import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY } from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(303, `/signin?redirect=${encodeURIComponent(url.pathname)}`);
  }
  const apiClient = gqlClient(locals.token);
  const orgsData = await apiClient
    .request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
    .catch(() => ({ myOrganizations: [] as Organization[] }));

  const orgs = orgsData.myOrganizations;
  const isConsumerMode = orgs.length === 1 && orgs[0].isVisible === null;

  return { user: locals.user, orgs, isConsumerMode };
};
