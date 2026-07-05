import { redirect } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
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
  // #477: the server hands off a single-use `?code=`, not the JWT. Redeem it
  // server-to-server so the 30-day JWT arrives in a response body and is seated
  // as an HttpOnly cookie here — it never rides in a browser-visible URL.
  const code = url.searchParams.get('code');
  if (!code) redirect(303, '/');

  // GitHub flow: present the browser nonce set at login start so the server can
  // confirm this is the same browser (session-fixation defense). The email flow
  // sets no nonce, and the server's code carries no binding — so absence is fine.
  const clientState = cookies.get('hadron_login_state') ?? undefined;
  cookies.delete('hadron_login_state', { path: '/auth' });

  const serverUrl = env.LOCAL_SERVER_URL ?? 'http://localhost:4000';
  let session: { token: string; redirect: string; isNew: boolean } | null = null;
  try {
    const res = await fetch(`${serverUrl}/auth/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, clientState }),
    });
    if (res.ok) session = (await res.json()) as { token: string; redirect: string; isNew: boolean };
  } catch {
    // network error — fall through to the failure redirect below
  }
  // redirect() throws, so it must run OUTSIDE the try (a catch would swallow it).
  if (!session) redirect(303, '/signin?error=auth');

  const token = session.token;
  cookies.set('hadron_token', token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  // Honor the server-provided destination (e.g. sign-in from a protected URL, or
  // the new-user /app/setup); otherwise resolve the active org and skip the
  // /app/dashboard 303→302 chain. #439: the destination originates from the
  // caller-supplied `redirect` at login start, so validate it is a same-origin
  // local path — an absolute/protocol-relative URL would otherwise open-redirect
  // the authenticated victim off-site.
  if (session.redirect && session.redirect !== '/') redirect(303, safeRedirect(session.redirect));

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
