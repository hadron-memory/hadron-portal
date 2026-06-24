/**
 * Tests for the org-detail Profile-tab loader (#336).
 *
 * The org (incl. 404 handling) is loaded by +layout.server.ts and reached via
 * parent(); those cases live in `layout.server.test.ts`. As of #364 this loader
 * does nothing but forward the parent org — the Memories/Agents/Apps quick-stat
 * cards (and their APPS_QUERY overfetch, originally spec 015) were removed, so
 * the loader issues no GraphQL request of its own.
 *
 * Strategy: mock `$lib/server/api`'s `gqlClient`, import `load` from
 * `+page.server.ts`, and call it directly with a hand-rolled event. We do NOT
 * spin up SvelteKit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

// ── Tests ────────────────────────────────────────────────────────────────────

describe('org-detail Profile load()', () => {
  it('forwards the parent org as { org }', async () => {
    const load = await importLoad();
    const result = await load(ev({ orgId: 'org-id-123' }));
    expect(result).toEqual({ org: fakeOrg });
  });

  it('issues no GraphQL request of its own (org comes from parent())', async () => {
    const load = await importLoad();
    await load(ev({}));
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
