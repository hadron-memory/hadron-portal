import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY, ME_QUERY } from '$lib/server/queries';
import type { Organization, UserSummary } from '$lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url }) => {
  if (!locals.user) {
    redirect(303, `/signin?redirect=${encodeURIComponent(url.pathname)}`);
  }
  const apiClient = gqlClient(locals.token);
  // Fetch orgs AND the full `me` profile in parallel. The JWT only carries
  // id/roles/githubUsername, so the avatar URL and name live server-side and
  // we must fetch them to render the sidebar avatar correctly.
  const [orgsData, meData] = await Promise.all([
    apiClient
      .request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
      .catch(() => ({ myOrganizations: [] as Organization[] })),
    apiClient
      .request<{ me: UserSummary | null }>(ME_QUERY)
      .catch(() => ({ me: null as UserSummary | null })),
  ]);

  const orgs = orgsData.myOrganizations;
  const isConsumerMode = orgs.length === 1 && orgs[0].isVisible === null;

  // Merge fresh server-side fields (name, avatarUrl, email) over the JWT
  // payload, so the layout always has current user metadata.
  const user = meData.me
    ? { ...locals.user, ...meData.me }
    : locals.user;

  return { user, orgs, isConsumerMode };
};
