import { redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { ORGANIZATIONS_NAV_QUERY, ME_QUERY } from '$lib/server/queries';
import { filterToMemberOrgs, resolveActiveOrg } from '$lib/server/active-org';
import { withQuery } from '$lib/safeRedirect';
import type { Organization, UserSummary } from '$lib/types';
import type { LayoutServerLoad } from './$types';

// Cookie that persists the user's last URL-selected org across navigations
// to routes without an org URL hint (e.g. /app/agents/[id], /app/dashboard).
// See #232. The cookie name is scoped by user id (`hadron_active_org_<uid>`)
// so multiple users on the same browser don't inherit each other's org
// selection on login — the resolver's membership filter would block the
// cross-user value anyway, but the per-user namespace prevents the UX
// confusion of a B-org popping up after B signs in following A. Future
// server-side `User.lastActiveOrgId` (spec 014 T003/T004) can supersede
// this for cross-device persistence; the cookie remains the same-device
// fast path.
const ACTIVE_ORG_COOKIE_PREFIX = 'hadron_active_org';
const ACTIVE_ORG_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
function activeOrgCookieName(userId: string): string {
  return `${ACTIVE_ORG_COOKIE_PREFIX}_${userId}`;
}

export const load: LayoutServerLoad = async ({ locals, url, params, cookies, parent }) => {
  if (!locals.user) {
    // #761: `url.search`, not `url.pathname` alone. This is the redirect a
    // SIGNED-OUT visitor hits, which makes it the common case for a shared deep
    // link — someone sends you `/app/u/<urn>?tab=chats`, you have no session,
    // and this layout intercepts before the route's own loader ever runs. The
    // resolver's UNAUTHENTICATED branch covers only the narrower case of a
    // token that decodes locally but the API then rejects, so fixing that one
    // alone left the ordinary path still dropping the query. Applies to every
    // /app/* deep link, not just the URN resolver.
    redirect(303, `/signin?redirect=${encodeURIComponent(withQuery(url.pathname, url.search))}`);
  }
  // #1117: read the shared `locals` ONCE, here at the guard, and use only the
  // snapshot below. Every load of the request shares `locals` and runs in
  // parallel; the root layout used to null `locals.user` / `.impersonation`
  // when its `me` failed (it no longer writes them), which landed while this
  // load awaited and made `locals.user.id` throw. Reading once keeps this load
  // coherent whatever another load does; it finishes as it began, with the
  // me-failed fallback below.
  const sessionUser = locals.user;
  const impersonation = locals.impersonation;
  const apiClient = gqlClient(locals.token);
  // Fetch orgs AND the full `me` profile in parallel. The JWT only carries
  // id/roles/githubUsername, so the avatar URL and name live server-side and
  // we must fetch them to render the sidebar avatar correctly.
  let meThrew = false;
  let orgsThrew = false;
  // `parent()` (the root layout's data) is awaited ALONGSIDE this layout's own
  // requests, so it costs no extra round trip; see the identity check below.
  const [orgs, meData, rootData] = await Promise.all([
    fetchAllItems<Organization>(apiClient, ORGANIZATIONS_NAV_QUERY, 'organizations')
      // Keep the app up if the org list fails, but REMEMBER it failed: an empty
      // list must not be read as "zero memberships" and flip a real org member
      // into consumer mode (Copilot review on #639). The error is a query/network
      // failure (no user-controlled data), so it's safe to log.
      .catch((e) => {
        orgsThrew = true;
        console.error('[app-layout] organizations query threw — org context unavailable this load:', e);
        return [] as Organization[];
      }),
    apiClient
      .request<{ me: UserSummary | null }>(ME_QUERY)
      // Don't 500 the whole app if `me` fails, but never swallow it silently.
      // The fallback below merges the JWT's locals.user (name/email/avatarUrl),
      // but `handle` is NOT in the JWT — so a lost `me` blanks the signed-in
      // user's handle (and leaves name/avatar at possibly-stale JWT values),
      // which is otherwise invisible in a SvelteKit server load
      // (hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch).
      .catch((e) => {
        meThrew = true;
        console.error('[app-layout] `me` query threw — user handle will be blank (name/avatar fall back to the JWT):', e);
        return { me: null as UserSummary | null };
      }),
    parent(),
  ]);
  // #1117: one response, one identity decision, and it's the root layout's.
  // When its own `me` receives an auth refusal it returns
  // `user: null` (the nav renders "Sign in") and drops the active cookie.
  // Rendering signed-in App content under that nav, or a target's
  // impersonation banner, made one response claim two identities (Atilla and
  // Colin on #1119). So defer to it, in one of two ways:
  //  - The root DROPPED a cookie (`sessionCleared`: an auth refusal).
  //    Redirect to this same URL; the next request, without that cookie, takes the
  //    existing path: the guard above sends a user to /signin, and an admin
  //    whose impersonation was dropped comes back as themselves.
  //  - Anything else (its `me` answered null: no auth, or a revoked
  //    impersonation). Nothing was dropped, so a reload would carry the same
  //    credential and get the same answer, a loop (Atilla's P2-2). Go where
  //    the guard sends a signed-out visitor.
  // #1120: transient root Me failures instead throw 503 through parent(),
  // preserving the cookie and bypassing these auth redirects entirely.
  const root = rootData as { user?: unknown; sessionCleared?: boolean };
  if (!root.user) {
    redirect(
      303,
      root.sessionCleared
        ? withQuery(url.pathname, url.search)
        : `/signin?redirect=${encodeURIComponent(withQuery(url.pathname, url.search))}`,
    );
  }
  // A `me` of null WITHOUT an error is the more common cause of a blank handle:
  // the `me` resolver returns null when `ctx.userId` is unset, i.e. the server
  // did not accept the session token even though the portal decoded it locally
  // (hooks.server.ts reads the JWT WITHOUT verifying the signature). Usually the
  // token was minted by a different server, or before a local DB / JWT-secret
  // change — re-authenticating fixes it. Log it distinctly so it's diagnosable.
  // Deliberately NO user id in the message: `sub` comes from an unverified JWT,
  // so it's attacker-controllable and must never reach the logs (log-injection,
  // #637 review). `sessionUser` is guaranteed set here (the load redirects
  // unauthenticated requests above).
  if (!meThrew && meData.me === null) {
    console.warn(
      '[app-layout] `me` returned null (no error) for the signed-in user — the server did ' +
        'not recognize the session token, so the handle will be blank. Sign out and back in ' +
        'if the token predates a local server / DB / JWT-secret change.',
    );
  }
  // hadron-server#473: nav + resolution use the slim membership-scoped
  // ORGANIZATIONS_NAV_QUERY (filter.memberOnly — the server excludes other
  // orgs even for a platform admin; admins browse ALL orgs on /app/orgs,
  // which fetches its own list). filterToMemberOrgs stays as cheap
  // defense-in-depth for consumer-mode detection and active-/personal-org
  // resolution.
  const memberOrgs = filterToMemberOrgs(orgs, sessionUser.id);
  // Consumer (individual) mode = the user belongs to NO organization. Since
  // #627 removed the per-user "personal org" (and its `isVisible` marker),
  // an individual simply has zero orgs and works out of org-less, user-owned
  // memories; anyone with a membership is an org member. Guard on `orgsThrew`
  // so a transient org-fetch failure (swallowed to `[]` above) can't misread a
  // real member as a consumer and hide their org UI — on failure we keep the
  // non-consumer default rather than downgrade.
  const isConsumerMode = !orgsThrew && memberOrgs.length === 0;

  // Merge fresh server-side fields (name, avatarUrl, email) over the JWT
  // payload, so the layout always has current user metadata.
  const user: UserSummary & { roles: string[] } = meData.me
    ? { ...sessionUser, ...meData.me, roles: sessionUser.roles }
    : { ...sessionUser, handle: null };

  // Spec 014: resolve the active organization (URL → lastActiveOrgId →
  // first membership). #232 fix: feed the persisted cookie as the lastActiveOrgId
  // step so navigations to routes without an org URL hint (e.g. opening
  // /app/agents/[id] from /app/orgs/<X>/agents) keep the previously-
  // selected org active. The hadron-server-side `lastActiveOrgId` field
  // (spec 014 T003/T004, R-7) is still deferred; when it lands, prefer
  // it over the cookie for cross-device persistence — the cookie remains
  // the same-device fast path.
  const paramsId = typeof params.id === 'string' ? params.id : undefined;
  const cookieName = activeOrgCookieName(sessionUser.id);
  const cookieOrgId = cookies.get(cookieName) ?? null;
  const resolution = resolveActiveOrg({
    paramsId,
    lastActiveOrgId: cookieOrgId,
    myOrganizations: memberOrgs,
  });

  // Persist the URL-driven selection so subsequent loads on org-less
  // routes can find it. Never write on the `first`-membership fallback — we
  // want it to stay a fallback, not become a sticky selection. Refresh on
  // `lastActive` to extend the cookie's TTL while the user is active.
  if (
    (resolution.source === 'url' || resolution.source === 'lastActive') &&
    resolution.activeOrgId
  ) {
    cookies.set(cookieName, resolution.activeOrgId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
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
    // Admin impersonation: the acting-as facts for the banner (null normally).
    // `user` above already IS the target under impersonation — hooks.server
    // swapped locals.token/user, and `me` resolves as the target.
    impersonation,
    // The nav/OrgSwitcher list — memberships only (an admin reaches the
    // all-orgs view on /app/orgs). memberOrgs, not the raw fetch, so the
    // client-side defense-in-depth applies to what the UI renders too.
    //
    // Named `navOrgs`, NOT `orgs`: SvelteKit's merged $page.data takes the
    // CHILD route's value on a key collision, and /app/orgs returns its own
    // page-local `orgs` (the full admin browse list). Under a shared `orgs`
    // key the nav/CommandBar switcher on that page would render non-member
    // orgs — and picking one bounces off the active-org resolver (PR #452
    // Codex P2). A distinct key keeps the layout list authoritative for the
    // nav everywhere.
    navOrgs: memberOrgs,
    isConsumerMode,
    activeOrgId: resolution.activeOrgId,
    activeOrg: resolution.activeOrg,
  };
};
