import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { ORGANIZATIONS_NAV_QUERY } from '$lib/server/queries';
import { filterToMemberOrgs, resolveActiveOrg } from '$lib/server/active-org';
import { safeRedirect } from '$lib/safeRedirect';
import type { Organization } from '$lib/types';
import type { PageServerLoad } from './$types';

/** Read the user id (sub claim) out of the freshly-issued JWT. The hooks
 *  handle hasn't seen the cookie yet on this request, so locals.user is not
 *  populated; verification is the server's job — we just need the id to
 *  filter memberships. */
function jwtSub(token: string): string | null {
  try {
    const [, payload] = token.split('.');
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof parsed.sub === 'string' ? parsed.sub : null;
  } catch {
    return null;
  }
}

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
  // org and skip the /app/dashboard 303→302 chain. #439: validate it is a
  // same-origin local path — an attacker-supplied absolute/protocol-relative
  // URL would otherwise open-redirect the authenticated victim off-site.
  if (explicitDest) redirect(303, safeRedirect(explicitDest));

  const orgs = await fetchAllItems<Organization>(gqlClient(token), ORGANIZATIONS_NAV_QUERY, 'organizations')
    .catch(() => [] as Organization[]);
  // hadron-server#473: resolve the landing org against memberships only —
  // the nav query is server-filtered (filter.memberOnly, admins included);
  // filterToMemberOrgs stays as defense-in-depth so the personal-org
  // fallback can never land an admin in another user's personal org.
  const { activeOrgId } = resolveActiveOrg({
    paramsId: undefined,
    lastActiveOrgId: null,
    myOrganizations: filterToMemberOrgs(orgs, jwtSub(token)),
  });
  redirect(303, activeOrgId ? `/app/orgs/${activeOrgId}/` : '/app/orgs/');
};
