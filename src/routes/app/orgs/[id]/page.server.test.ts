/**
 * Spec 015-fix-org-apps-count — tests for the org-detail loader.
 *
 * Strategy mirrors `memories/[gid]/page.server.test.ts`: mock
 * `$lib/server/api`'s `gqlClient`, import `load` from `+page.server.ts`,
 * and call it directly with a hand-rolled event. We do NOT spin up SvelteKit.
 *
 * Coverage (T001 from spec 015's tasks.md):
 *   - happy path → returns { org, apps, appsError: null }
 *   - APPS_QUERY fails, ORGANIZATION_QUERY succeeds → returns
 *     { org, apps: [], appsError: <message> }; no throw, no 404
 *   - ORGANIZATION_QUERY fails → throws SvelteKit 404 (apps-query
 *     outcome irrelevant; uses Promise.allSettled so apps-query
 *     completion does not change the 404 result)
 *   - ORGANIZATION_QUERY returns { organization: null } → throws 404
 *   - parallel issuance — both queries are dispatched (mockRequest
 *     called twice; order doesn't matter)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORGANIZATION_QUERY, APPS_QUERY } from '$lib/server/queries';

// ── Mocks ──────────────────────────────────────────────────────────────────

// `$env/dynamic/private` is a SvelteKit virtual module; vitest is configured
// to skip the SvelteKit plugin (see vitest.config.ts). The org-detail
// +page.server.ts imports `env` for the `connectExchange` action — these
// load() tests don't exercise that action, so an empty stub is sufficient.
vi.mock('$env/dynamic/private', () => ({ env: {} }));

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

// ── Helpers ────────────────────────────────────────────────────────────────

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev(opts: { orgId?: string; token?: string | null } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
    parent: async () => ({}),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

/**
 * Route mockRequest by query identity. ORGANIZATION_QUERY and APPS_QUERY
 * are imported from the real `queries.ts` so the strings match exactly.
 */
function routeMock(opts: {
  org?: { data?: unknown; error?: unknown };
  apps?: { data?: unknown; error?: unknown };
}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORGANIZATION_QUERY) {
      if (opts.org?.error !== undefined) throw opts.org.error;
      return opts.org?.data;
    }
    if (query === APPS_QUERY) {
      if (opts.apps?.error !== undefined) throw opts.apps.error;
      return opts.apps?.data;
    }
    throw new Error(`Unexpected query passed to mockRequest`);
  });
}

const fakeOrg = { id: 'org-id-123', name: 'Acme', urn: 'urn:org:acme', members: [], memories: [], agents: [], subscriptions: [], exchangeConnections: [] };
const fakeApps = [
  { id: 'app-1', name: 'First App', urn: 'urn:app:first', agents: [], keys: [], identifyUserMethod: 'EMAIL', createUserPermission: 'ANYONE' },
];

// ── Tests ──────────────────────────────────────────────────────────────────

describe('org-detail load() (spec 015)', () => {
  it('happy path — both queries succeed → returns { org, apps, appsError: null }', async () => {
    routeMock({
      org: { data: { organization: fakeOrg } },
      apps: { data: { apps: fakeApps } },
    });
    const load = await importLoad();
    const result = await load(ev({ orgId: 'org-id-123' }));
    expect(result).toEqual({ org: fakeOrg, apps: fakeApps, appsError: null });
  });

  it('apps-query fails, org-query succeeds → returns { org, apps: [], appsError } without throwing', async () => {
    const gqlError = Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'Internal: apps resolver crashed' }] },
    });
    routeMock({
      org: { data: { organization: fakeOrg } },
      apps: { error: gqlError },
    });
    const load = await importLoad();
    const result = await load(ev({}));
    expect(result).toEqual({
      org: fakeOrg,
      apps: [],
      appsError: 'Internal: apps resolver crashed',
    });
  });

  it('apps-query fails with non-GraphQL error → falls back to the error message', async () => {
    routeMock({
      org: { data: { organization: fakeOrg } },
      apps: { error: new Error('socket hangup') },
    });
    const load = await importLoad();
    const result = (await load(ev({}))) as { apps: unknown[]; appsError: string };
    expect(result.appsError).toBe('socket hangup');
    expect(result.apps).toEqual([]);
  });

  it('org-query fails → throws SvelteKit 404, regardless of apps-query outcome', async () => {
    routeMock({
      org: { error: new Error('boom') },
      apps: { data: { apps: fakeApps } }, // apps would succeed; must not change the 404
    });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({}));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect((thrown as { status: number }).status).toBe(404);
    expect((thrown as { body?: { message?: string } }).body?.message).toBe('Organization not found');
  });

  it('organization is null (org exists in schema but resolver returned null) → throws 404', async () => {
    routeMock({
      org: { data: { organization: null } },
      apps: { data: { apps: [] } },
    });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({}));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
  });

  it('parallel issuance — both queries are dispatched (independent of resolution order)', async () => {
    routeMock({
      org: { data: { organization: fakeOrg } },
      apps: { data: { apps: fakeApps } },
    });
    const load = await importLoad();
    await load(ev({}));

    expect(mockRequest).toHaveBeenCalledTimes(2);
    const queries = mockRequest.mock.calls.map((call) => call[0]);
    expect(queries).toContain(ORGANIZATION_QUERY);
    expect(queries).toContain(APPS_QUERY);
    // Variables matched to the right query
    const orgCall = mockRequest.mock.calls.find((c) => c[0] === ORGANIZATION_QUERY);
    const appsCall = mockRequest.mock.calls.find((c) => c[0] === APPS_QUERY);
    expect(orgCall?.[1]).toEqual({ id: 'org-id-123' });
    expect(appsCall?.[1]).toEqual({ orgId: 'org-id-123' });
  });
});
