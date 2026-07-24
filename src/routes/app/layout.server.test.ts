/**
 * Spec 014-single-active-org — tests for the `+layout.server.ts` load
 * function. Verifies the active-org resolution is wired into layout data
 * and that the layout cleanly falls back to the user's first membership
 * when no URL hint is present.
 *
 * Post-#627: the per-user "personal org" (and `Organization.isVisible`) were
 * removed. An individual now has ZERO orgs (isConsumerMode) and works out of
 * org-less memories; a member falls back to their first org.
 *
 * Strategy mirrors the spec 013 page.server.test.ts pattern: mock
 * `$lib/server/api`'s `gqlClient`, import the `load` function, and call
 * it with a hand-rolled SvelteKit-shaped event.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockMyOrgsRequest = vi.fn();
const mockMeRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({
    request: async (query: string) => {
      // The portal calls ORGANIZATIONS_NAV_QUERY (the slim membership-scoped
      // list — filter.memberOnly is baked into the query text, so no filter
      // variable reaches this mock) and ME_QUERY in parallel. Dispatch by
      // query string heuristic. Wrap the org fixtures in the uniform
      // { items, total } page envelope (hadron-server#473).
      if (query.includes('organizations(')) {
        const res = (await mockMyOrgsRequest(query)) as { organizations: unknown[] };
        return { organizations: { items: res.organizations, total: res.organizations.length } };
      }
      return mockMeRequest(query);
    },
  }),
}));

beforeEach(() => {
  mockMyOrgsRequest.mockReset();
  mockMeRequest.mockReset();
});

function makeOrg(overrides: {
  id: string;
  name?: string;
  /** Whose membership rows the org carries. Defaults to the test user —
   *  pass another id to model an org the test user is NOT a member of
   *  (visible to platform admins via organizations(), hadron-server#473). */
  memberUserId?: string;
}) {
  return {
    id: overrides.id,
    name: overrides.name ?? `Org ${overrides.id}`,
    urn: `org:${overrides.id}`,
    githubInstallationId: null,
    githubAppId: null,
    hasGithubAppPrivateKey: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    members: [
      { id: `member-${overrides.id}`, role: 'MEMBER', user: { id: overrides.memberUserId ?? 'user-1' } },
    ],
  };
}

// Test users — the cookie name is scoped to user.id, so tests that read or
// assert the cookie must reference the matching scoped name.
const TEST_USER_ID = 'user-1';
const ACTIVE_ORG_COOKIE_NAME = `hadron_active_org_${TEST_USER_ID}`;

function ev(opts: {
  paramsId?: string;
  pathname?: string;
  authed?: boolean;
  /** Pre-existing active-org cookie value (defaults to absent). */
  activeOrgCookie?: string;
}) {
  const cookieJar = new Map<string, string>();
  if (opts.activeOrgCookie) cookieJar.set(ACTIVE_ORG_COOKIE_NAME, opts.activeOrgCookie);
  const setCalls: Array<{ name: string; value: string; opts: unknown }> = [];
  return {
    locals: opts.authed === false
      ? { user: null, token: null }
      : {
          user: { id: 'user-1', roles: ['user'], githubUsername: 'gh-user' },
          token: 'test-token',
        },
    url: new URL(`http://localhost${opts.pathname ?? '/app/dashboard'}`),
    params: opts.paramsId ? { id: opts.paramsId } : {},
    cookies: {
      get: (name: string) => cookieJar.get(name),
      set: (name: string, value: string, o: unknown) => {
        cookieJar.set(name, value);
        setCalls.push({ name, value, opts: o });
      },
      delete: (name: string) => { cookieJar.delete(name); },
      getAll: () => [...cookieJar.entries()].map(([name, value]) => ({ name, value })),
      serialize: (name: string, value: string) => `${name}=${value}`,
    },
    /** Test-only accessor for asserting `cookies.set` was/wasn't called. */
    _cookieSetCalls: setCalls,
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0] & {
    _cookieSetCalls: Array<{ name: string; value: string; opts: unknown }>;
  };
}

async function importLoad() {
  const mod = await import('./+layout.server');
  return mod.load;
}

/**
 * Narrow the `void | PageData` union the auto-generated SvelteKit load
 * type returns. In tests we never exercise the unauth redirect branch
 * (which is the source of the `void` arm), so the result is always the
 * data shape.
 */
async function loadAuthed(
  ...args: Parameters<Awaited<ReturnType<typeof importLoad>>>
): Promise<{
  user: { id: string; roles: string[]; githubUsername: string; name?: string; avatarUrl?: string | null; email?: string };
  navOrgs: ReturnType<typeof makeOrg>[];
  isConsumerMode: boolean;
  activeOrgId: string | null;
  activeOrg: ReturnType<typeof makeOrg> | null;
}> {
  const load = await importLoad();
  const data = await load(...args);
  if (!data) throw new Error('Expected layout load to return data, got void (unauth redirect path)');
  return data as never;
}

describe('+layout.server.ts — spec 014 active-org resolution wiring', () => {
  it('warns (distinctly) when `me` returns null for a signed-in user — server rejected the token', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [] });
      mockMeRequest.mockResolvedValueOnce({ me: null }); // resolver returns null (no throw) → ctx.userId unset

      const data = await loadAuthed(ev({ pathname: '/app/dashboard' }));

      // loadAuthed's declared `user` type doesn't surface `handle`; cast to read it.
      expect((data.user as unknown as { handle: string | null }).handle).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('did not recognize the session token'));
    } finally {
      warnSpy.mockRestore(); // restore even if an assertion fails, so it can't leak
    }
  });

  it('populates activeOrgId from params.id when on /app/orgs/[id]/...', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({
      me: { id: 'user-1', handle: 'h', githubUsername: 'gh-user', name: 'U', avatarUrl: null, email: 'a@b', roles: ['user'] },
    });

    const data = await loadAuthed(ev({ paramsId: 'org-b', pathname: '/app/orgs/org-b/agents' }));

    expect(data.activeOrgId).toBe('org-b');
    expect(data.activeOrg).toMatchObject({ id: 'org-b' });
  });

  it('falls back to the first membership when no URL hint and no lastActiveOrgId', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({ pathname: '/app/dashboard' }));

    expect(data.activeOrgId).toBe('org-a');
    expect(data.activeOrg).toMatchObject({ id: 'org-a' });
  });

  it('302-redirects with the resolved id substituted when paramsId is a non-member org (FR-009 / R-9 path preservation)', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ paramsId: 'org-strangers', pathname: '/app/orgs/org-strangers/agents' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(302);
    // Falls back to the first membership (org-a) and preserves the trailing path.
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-a/agents');
  });

  it('preserves a deeper trailing path on inaccessible-deep-link redirect (org-scoped sub-route)', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({ paramsId: 'org-strangers', pathname: '/app/orgs/org-strangers/agents/agent-xyz' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(302);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-a/agents/agent-xyz');
  });

  it('#260 — does NOT redirect on /app/memories/[id] (params.id is a memory id, gate is /app/orgs-only)', async () => {
    // Memory detail pages are org-less. `params.id` is the memory id, which
    // never matches a member org, so resolveActiveOrg falls back to the first
    // membership — but the segment-3 rewrite gate is scoped to /app/orgs/ and
    // must NOT fire here, or every shared-memory deep link would bounce.
    const orgA = makeOrg({ id: 'org-a' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({ paramsId: 'mem-xyz', pathname: '/app/memories/mem-xyz' }));

    expect(data.activeOrgId).toBe('org-a');
  });

  it('does NOT redirect when paramsId IS a member org (resolution.source === url)', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({ paramsId: 'org-a', pathname: '/app/orgs/org-a/agents' }));
    expect(data.activeOrgId).toBe('org-a');
  });

  it('is NOT consumer mode for a member of a single org — the org becomes active', async () => {
    // Regression for "member of several orgs sees none": a single membership
    // must resolve to an active org (source=first), not a null/consumer state.
    const orgA = makeOrg({ id: 'org-a' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({ pathname: '/app/dashboard' }));

    expect(data.isConsumerMode).toBe(false);
    expect(data.activeOrgId).toBe('org-a');
  });

  it('is NOT consumer mode for a member of several orgs — falls back to the first (holger repro)', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    const orgC = makeOrg({ id: 'org-c' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB, orgC] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({ pathname: '/app/dashboard' }));

    expect(data.isConsumerMode).toBe(false);
    expect(data.activeOrgId).toBe('org-a');
    // The whole membership list is handed to the nav so the OrgSwitcher renders.
    expect(data.navOrgs.map((o) => o.id)).toEqual(['org-a', 'org-b', 'org-c']);
  });

  it('is consumer mode with a null active org for an org-less individual (#627)', async () => {
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({ pathname: '/app/dashboard' }));

    expect(data.isConsumerMode).toBe(true);
    expect(data.activeOrgId).toBeNull();
    expect(data.activeOrg).toBeNull();
    expect(data.navOrgs).toHaveLength(0);
  });

  // Spec 018 regression — the segment-3 rewrite is gated to /app/orgs/.
  // Previously it fired on any route with an [id] segment (including
  // /app/agents/[id]), which corrupted the agent id with the active org
  // id and forced the agent detail page to 404 on a URL it never asked
  // for. The rewrite MUST remain a no-op on non-/app/orgs/ paths.
  it('Spec 018: does NOT rewrite segment 3 on /app/agents/[id] when params.id is the agent id', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({
      paramsId: 'agent-abc-not-an-org-id',
      pathname: '/app/agents/agent-abc-not-an-org-id',
    }));

    // No redirect — load returns normally with the first membership active.
    expect(data.activeOrgId).toBe('org-a');
  });

  // Pin the gate's scope: any future top-level [id]-bearing surface
  // outside /app/orgs/ must NOT trigger the org-id rewrite.
  it('Spec 018: does NOT rewrite segment 3 on a hypothetical /app/foo/[id] surface either', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({
      paramsId: 'thing-not-an-org-id',
      pathname: '/app/foo/thing-not-an-org-id',
    }));

    expect(data.activeOrgId).toBe('org-a');
  });
});

/**
 * #232 — persist URL-selected org via `hadron_active_org` cookie so
 * navigations to routes without an org URL hint (e.g. /app/agents/[id])
 * keep the previously-selected org active instead of falling back to the
 * first membership.
 */
describe('+layout.server.ts — #232 active-org cookie persistence', () => {
  it('writes the cookie when the URL drives org selection (source=url)', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const event = ev({ paramsId: 'org-b', pathname: '/app/orgs/org-b/agents' });
    await loadAuthed(event);

    const cookieWrites = (event as unknown as { _cookieSetCalls: Array<{ name: string; value: string }> })._cookieSetCalls;
    expect(cookieWrites).toContainEqual(
      expect.objectContaining({ name: ACTIVE_ORG_COOKIE_NAME, value: 'org-b' }),
    );
  });

  it('uses the cookie as lastActiveOrgId on routes without an org URL hint (repro for #232)', async () => {
    // Repro shape: user clicks an agent from /app/orgs/org-b/agents, lands
    // on /app/agents/<id>. Without the cookie, the layout would fall back to
    // the first membership (org-a). With the cookie present, it should keep org-b.
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b', name: 'Hadron Memory' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({
      paramsId: 'agent-abc',
      pathname: '/app/agents/agent-abc',
      activeOrgCookie: 'org-b',
    }));

    expect(data.activeOrgId).toBe('org-b');
    expect(data.activeOrg).toMatchObject({ id: 'org-b', name: 'Hadron Memory' });
  });

  it('refreshes the cookie on every successful read so the 30-day TTL extends with usage', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const event = ev({
      pathname: '/app/agents/agent-abc',
      paramsId: 'agent-abc',
      activeOrgCookie: 'org-b',
    });
    await loadAuthed(event);

    const cookieWrites = (event as unknown as { _cookieSetCalls: Array<{ name: string; value: string }> })._cookieSetCalls;
    expect(cookieWrites).toContainEqual(
      expect.objectContaining({ name: ACTIVE_ORG_COOKIE_NAME, value: 'org-b' }),
    );
  });

  it('does NOT write the cookie when resolution falls back to the first membership', async () => {
    // No URL hint, no cookie → first-membership fallback. We must NOT write the
    // fallback id into the cookie, or it would become a sticky selection and
    // prevent the cookie from ever capturing a real URL-driven choice.
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const event = ev({ pathname: '/app/dashboard' });
    await loadAuthed(event);

    const cookieWrites = (event as unknown as { _cookieSetCalls: Array<{ name: string; value: string }> })._cookieSetCalls;
    expect(cookieWrites.filter((c) => c.name === ACTIVE_ORG_COOKIE_NAME)).toHaveLength(0);
  });

  it('tolerates a stale cookie (org the user no longer has access to) by falling back to the first membership', async () => {
    // User was kicked from org-b; the cookie still says org-b. Resolver's
    // membership filter handles this — the cookie value is ignored and
    // resolution continues to the first membership. The stale cookie is NOT
    // overwritten (fallback-source rule above) — it'll expire naturally, or be
    // replaced the next time the user visits an /app/orgs/<id>/ URL.
    const orgA = makeOrg({ id: 'org-a' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({
      pathname: '/app/dashboard',
      activeOrgCookie: 'org-b-no-longer-member',
    }));

    expect(data.activeOrgId).toBe('org-a');
  });

  it('sets the cookie with HttpOnly, SameSite=Lax, Path=/, and a 30-day MaxAge', async () => {
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const event = ev({ paramsId: 'org-b', pathname: '/app/orgs/org-b/agents' });
    await loadAuthed(event);

    const cookieWrites = (event as unknown as { _cookieSetCalls: Array<{ name: string; value: string; opts: Record<string, unknown> }> })._cookieSetCalls;
    const orgCookieWrite = cookieWrites.find((c) => c.name === ACTIVE_ORG_COOKIE_NAME);
    expect(orgCookieWrite?.opts).toMatchObject({
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      // `secure` is gated to NODE_ENV === 'production'. In the test env
      // NODE_ENV is 'test', so the flag is false here — production
      // deployments get it true via the same gate `hadron_token` uses
      // (see auth/callback/+page.server.ts).
      secure: false,
      maxAge: 60 * 60 * 24 * 30,
    });
  });

  it('scopes the cookie name to the authenticated user id to avoid cross-user state leakage on shared devices', async () => {
    // If user A logs out and user B logs in on the same browser, B must
    // not inherit A's active org. The cookie name encodes the user id, so
    // the get() lookup for B (cookie `hadron_active_org_<B-id>`) misses
    // any value A wrote (cookie `hadron_active_org_<A-id>`), and B falls
    // back to the first-membership default cleanly.
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const event = ev({ paramsId: 'org-b', pathname: '/app/orgs/org-b/agents' });
    await loadAuthed(event);

    const cookieWrites = (event as unknown as { _cookieSetCalls: Array<{ name: string }> })._cookieSetCalls;
    const names = cookieWrites.map((c) => c.name);
    expect(names).toContain(`hadron_active_org_${TEST_USER_ID}`);
    expect(names).not.toContain('hadron_active_org');
  });
});

describe('+layout.server.ts — hadron-server#473 admin/non-member org handling', () => {
  it("resolves the admin's OWN first membership even when another user's org sorts first", async () => {
    // The layout now fetches via ORGANIZATIONS_NAV_QUERY, whose
    // filter.memberOnly makes the SERVER return memberships only (admins
    // included). This test feeds a response that ignores the filter —
    // modeling a stale/misbehaving server — to pin the client-side
    // filterToMemberOrgs defense-in-depth: the first-membership fallback must
    // only consider actual memberships, or the admin lands in someone
    // else's org (PR #451 review P2).
    const foreign = makeOrg({ id: 'org-aaa-foreign', memberUserId: 'user-OTHER' });
    const own = makeOrg({ id: 'org-zzz-own' });
    const orgA = makeOrg({ id: 'org-a' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [foreign, own, orgA] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({ pathname: '/app/dashboard' }));

    // 'org-aaa-foreign' sorts first but isn't a membership; the first of the
    // filtered list ('org-zzz-own') wins.
    expect(data.activeOrgId).toBe('org-zzz-own');
    expect(data.navOrgs).toHaveLength(2);
    expect(data.navOrgs.map((o) => o.id)).not.toContain('org-aaa-foreign');
  });

  it("returns the nav list under `navOrgs`, never `orgs` (child pages' own `orgs` must not shadow it)", async () => {
    // PR #452 Codex P2: SvelteKit's merged $page.data takes the CHILD
    // route's value on a key collision, and /app/orgs returns its own
    // page-local `orgs` (the full admin browse list). If the layout ever
    // reverts to the shared `orgs` key, the Nav/CommandBar switcher on that
    // page would render non-member orgs — and picking one bounces off the
    // active-org resolver. Pin the distinct key.
    const orgA = makeOrg({ id: 'org-a' });
    const orgB = makeOrg({ id: 'org-b' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [orgA, orgB] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    const data = await loadAuthed(ev({ pathname: '/app/dashboard' }));

    expect(data.navOrgs.map((o) => o.id)).toEqual(['org-a', 'org-b']);
    expect(data).not.toHaveProperty('orgs');
  });

  it('non-member orgs never satisfy the URL hint (falls back to own first membership)', async () => {
    const foreignOrg = makeOrg({ id: 'org-foreign', memberUserId: 'user-OTHER' });
    const own = makeOrg({ id: 'org-own' });
    mockMyOrgsRequest.mockResolvedValueOnce({ organizations: [foreignOrg, own] });
    mockMeRequest.mockResolvedValueOnce({ me: null });

    // URL names the non-member org → resolution must NOT activate it.
    let redirected: { status: number; location: string } | null = null;
    try {
      await loadAuthed(ev({ paramsId: 'org-foreign', pathname: '/app/orgs/org-foreign/agents' }));
    } catch (e) {
      redirected = e as { status: number; location: string };
    }
    // Spec 014 FR-009 fall-through: the layout rewrites the org segment to
    // the resolved (member) org and redirects.
    expect(redirected?.status).toBe(302);
    expect(redirected?.location).toBe('/app/orgs/org-own/agents');
  });
});
