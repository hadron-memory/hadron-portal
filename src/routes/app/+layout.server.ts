import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY, ME_QUERY } from '$lib/server/queries';
import { resolveActiveOrg } from '$lib/server/active-org';
import type { Organization, UserSummary } from '$lib/types';
import type { LayoutServerLoad } from './$types';

// Cookie that persists the user's last URL-selected org across navigations
// to routes without an org URL hint (e.g. /app/agents/[id], /app/dashboard).
// See #232. Future server-side `User.lastActiveOrgId` (spec 014 T003/T004)
// can supersede this — keep the cookie as a fallback / cross-device-off
// path even after that lands.
const ACTIVE_ORG_COOKIE = 'hadron_active_org';
const ACTIVE_ORG_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export const load: LayoutServerLoad = async ({ locals, url, params, cookies }) => {
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
  const isConsumerMode = orgs.length === 1 && orgs[0].isVisible !== true;

  // Merge fresh server-side fields (name, avatarUrl, email) over the JWT
  // payload, so the layout always has current user metadata.
  const user: UserSummary & { roles: string[] } = meData.me
    ? { ...locals.user, ...meData.me, roles: locals.user.roles }
    : { ...locals.user, handle: null };

  // Spec 014: resolve the active organization (URL → lastActiveOrgId →
  // personal). #232 fix: feed the persisted cookie as the lastActiveOrgId
  // step so navigations to routes without an org URL hint (e.g. opening
  // /app/agents/[id] from /app/orgs/<X>/agents) keep the previously-
  // selected org active. The hadron-server-side `lastActiveOrgId` field
  // (spec 014 T003/T004, R-7) is still deferred; when it lands, prefer
  // it over the cookie for cross-device persistence — the cookie remains
  // the same-device fast path.
  const paramsId = typeof params.id === 'string' ? params.id : undefined;
  const cookieOrgId = cookies.get(ACTIVE_ORG_COOKIE) ?? null;
  const resolution = resolveActiveOrg({
    paramsId,
    lastActiveOrgId: cookieOrgId,
    myOrganizations: orgs,
  });

  // Persist the URL-driven selection so subsequent loads on org-less
  // routes can find it. Never write on `personal` fallback — we want it
  // to stay a fallback, not become a sticky selection. Refresh on
  // `lastActive` to extend the cookie's TTL while the user is active.
  if (
    (resolution.source === 'url' || resolution.source === 'lastActive') &&
    resolution.activeOrgId
  ) {
    cookies.set(ACTIVE_ORG_COOKIE, resolution.activeOrgId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: ACTIVE_ORG_COOKIE_MAX_AGE,
    });
  }

  // Spec 014 FR-009 / R-9 — inaccessible deep-link handling. If the URL
  // names an org id that the user is not a member of (deleted org, kicked,
  // never had access), the resolver falls through and picks a different
  // (accessible) org. Swap segment index 3 (the org id slot in
  // /app/orgs/<id>/...) rather than using string replace, so an org id
  // that happens to appear as a substring elsewhere in the path can't
  // cause the wrong segment to be rewritten.
  //
  // Spec 018: gate on /app/orgs/ — `params.id` exists on every route
  // with an `[id]` segment, including /app/agents/[id]/, where segment
  // 3 is the AGENT id, not an org id. Without this gate the layout
  // rewrote the agent id to the active org id and the agent detail
  // page 404'd on a URL it never asked for.
  if (
    url.pathname.startsWith('/app/orgs/') &&
    paramsId &&
    resolution.activeOrgId &&
    resolution.activeOrgId !== paramsId
  ) {
    const segments = url.pathname.split('/');
    segments[3] = resolution.activeOrgId;
    redirect(302, segments.join('/') + url.search);
  }

  return {
    user,
    orgs,
    isConsumerMode,
    activeOrgId: resolution.activeOrgId,
    activeOrg: resolution.activeOrg,
    personalOrgId: resolution.personalOrgId,
  };
};
