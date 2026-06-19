/**
 * Tests for the org-detail Profile-tab loader (#336, originally spec
 * 015-fix-org-apps-count).
 *
 * The org (incl. 404 handling) is loaded by +layout.server.ts and reached via
 * parent(); those cases live in `layout.server.test.ts`. This loader only adds
 * the apps stat (APPS_QUERY) on top of the parent org.
 *
 * Strategy: mock `$lib/server/api`'s `gqlClient`, import `load` from
 * `+page.server.ts`, and call it directly with a hand-rolled event. We do NOT
 * spin up SvelteKit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APPS_QUERY } from '$lib/server/queries';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

// ── Helpers ────────────────────────────────────────────────────────────────

const fakeOrg = { id: 'org-id-123', name: 'Acme', urn: 'urn:org:acme', members: [], memories: [], agents: [], subscriptions: [], exchangeConnections: [] };
// Fixture mirrors the AppFields selection set (post-008 single-agent
// model) and uses literals from the App type union.
const fakeApps = [
  { id: 'app-1', name: 'First App', urn: 'urn:app:first', agent: null, keys: [], identifyUserMethod: 'USER_ID', createUserPermission: 'DENY' },
];

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev(opts: { orgId?: string; token?: string | null } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
    parent: async () => ({ org: fakeOrg }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

function routeMock(opts: { apps?: { data?: unknown; error?: unknown } }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === APPS_QUERY) {
      if (opts.apps?.error !== undefined) throw opts.apps.error;
      return opts.apps?.data;
    }
    throw new Error('Unexpected query passed to mockRequest');
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('org-detail Profile load()', () => {
  it('happy path — apps query succeeds → returns { org, apps, appsError: null }', async () => {
    routeMock({ apps: { data: { apps: fakeApps } } });
    const load = await importLoad();
    const result = await load(ev({ orgId: 'org-id-123' }));
    expect(result).toEqual({ org: fakeOrg, apps: fakeApps, appsError: null });
  });

  it('apps-query fails → returns { org, apps: [], appsError } without throwing', async () => {
    const gqlError = Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'Internal: apps resolver crashed' }] },
    });
    routeMock({ apps: { error: gqlError } });
    const load = await importLoad();
    const result = await load(ev({}));
    expect(result).toEqual({
      org: fakeOrg,
      apps: [],
      appsError: 'Internal: apps resolver crashed',
    });
  });

  it('apps-query fails with non-GraphQL error → falls back to the error message', async () => {
    routeMock({ apps: { error: new Error('socket hangup') } });
    const load = await importLoad();
    const result = (await load(ev({}))) as { apps: unknown[]; appsError: string };
    expect(result.appsError).toBe('socket hangup');
    expect(result.apps).toEqual([]);
  });

  it('issues APPS_QUERY only (org comes from parent()), scoped to the org id', async () => {
    routeMock({ apps: { data: { apps: fakeApps } } });
    const load = await importLoad();
    await load(ev({}));
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][0]).toBe(APPS_QUERY);
    expect(mockRequest.mock.calls[0][1]).toEqual({ orgId: 'org-id-123' });
  });
});
