import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY } from '$lib/server/queries';
import { resolveActiveOrg } from '$lib/server/active-org';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url, cookies }) => {
  const token = url.searchParams.get('token');
  if (!token) redirect(303, '/');

  const explicitDest = url.searchParams.get('redirect');

  cookies.set('hadron_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  // Honor an explicit ?redirect=... if the caller supplied one (e.g. a
  // sign-in initiated from a protected URL); otherwise resolve the active
  // org and skip the /app/dashboard 303→302 chain.
  if (explicitDest) redirect(303, explicitDest);

  const orgsData = await gqlClient(token)
    .request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
    .catch(() => ({ myOrganizations: [] as Organization[] }));
  const { activeOrgId } = resolveActiveOrg({
    paramsId: undefined,
    lastActiveOrgId: null,
    myOrganizations: orgsData.myOrganizations,
  });
  redirect(303, activeOrgId ? `/app/orgs/${activeOrgId}/` : '/app/orgs/');
};
