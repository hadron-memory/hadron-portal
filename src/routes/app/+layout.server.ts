import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MY_ORGANIZATIONS_QUERY, ME_QUERY } from '$lib/server/queries';
import { resolveActiveOrg } from '$lib/server/active-org';
import type { Organization, UserSummary } from '$lib/types';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals, url, params }) => {
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
  // personal). lastActiveOrgId is wired as `null` for now — extending
  // ME_QUERY to select it (T003) and writing it back via setLastActiveOrg
  // (T004) is deferred until the hadron-server adds the field. See spec
  // 014 research.md R-7 for the cross-repo sequencing.
  const paramsId = typeof params.id === 'string' ? params.id : undefined;
  const resolution = resolveActiveOrg({
    paramsId,
    lastActiveOrgId: null,
    myOrganizations: orgs,
  });

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
