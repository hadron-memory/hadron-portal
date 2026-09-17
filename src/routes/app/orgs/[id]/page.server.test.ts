/**
 * Tests for the org-detail Profile-tab loader (#336).
 *
 * #845 CHANGED THE CONTRACT THESE TESTS PIN. Read this before "fixing" one.
 *
 * #364/#382 had this loader forward the parent org and issue no query of its
 * own. That could not survive #845: the layout now fetches CHROME ONLY (id,
 * name, urn), because every nested field on Organization is non-null while
 * `organization(ref:)` is nullable — so one list resolver failing propagated a
 * null up to `organization` and the layout's 404 replaced every tab.
 *
 * The Profile tab renders `members`, `createdAt` and `subscriptions`, so it now
 * fetches the full org itself through `loadOrgDetail`. The assertion that
 * inverted — "issues no GraphQL request of its own" — is replaced by one
 * pinning the opposite, deliberately, rather than deleted.
 *
 * Strategy: mock `$lib/server/api`'s `gqlClient`, import `load` from
 * `+page.server.ts`, and call it directly with a hand-rolled event. We do NOT
 * spin up SvelteKit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORG_PROFILE_QUERY } from '$lib/server/queries';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

// ── Helpers ────────────────────────────────────────────────────────────────

const fakeOrg = { id: 'org-id-123', name: 'Acme', urn: 'urn:org:acme.com', members: [], memories: [], agents: [], subscriptions: [], exchangeConnections: [] };

async function importMod() {
  return import('./+page.server');
}

function ev(opts: { orgId?: string; token?: string | null; userId?: string | null } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: {
      token: opts.token === undefined ? 'test-token' : opts.token,
      user: { id: opts.userId === undefined ? 'user-1' : opts.userId },
    },
      // #845: chrome only. Kept load-bearing on purpose — if this loader ever
    // goes back to reading a list off parent(), the fixture must not supply it.
    parent: async () => ({ org: { id: fakeOrg.id, name: fakeOrg.name, urn: fakeOrg.urn } }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['load']>[0];
}

// Minimal form-action event: params + locals + a request whose formData()
// returns the supplied fields.
function actionEv(fields: Record<string, string>, opts: { orgId?: string } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['update']>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('org-detail Profile load()', () => {
  it('returns the org it fetched, and the current user id', async () => {
    mockRequest.mockResolvedValueOnce({ organization: fakeOrg });
    const { load } = await importMod();
    const result = await load(ev({ orgId: 'org-id-123', userId: 'user-1' }));
    expect(result).toMatchObject({ org: fakeOrg, currentUserId: 'user-1' });
    expect((result as { form: { valid: boolean } }).form.valid).toBe(true);
  });

  it('null currentUserId when there is no logged-in user', async () => {
    mockRequest.mockResolvedValueOnce({ organization: fakeOrg });
    const { load } = await importMod();
    const result = await load(ev({ userId: null }));
    expect(result).toMatchObject({ org: fakeOrg, currentUserId: null });
  });

  // #845, and the inverse of what #382 pinned here. The Profile tab reads
  // `members`/`createdAt`/`subscriptions`, none of which the layout carries any
  // more, so it MUST issue its own query — and asserting the document keeps
  // that honest rather than counting calls.
  it('fetches the full org itself, because the layout carries chrome only', async () => {
    mockRequest.mockResolvedValueOnce({ organization: fakeOrg });
    const { load } = await importMod();
    await load(ev({}));
    expect(mockRequest).toHaveBeenCalledWith(ORG_PROFILE_QUERY, { ref: 'org-id-123' });
  });

  // The containment #845 bought: a nested list failing nulls `organization`,
  // and that now takes out THIS TAB rather than the chrome every tab renders.
  it('404s this tab when the org comes back null, leaving the layout intact', async () => {
    mockRequest.mockResolvedValueOnce({ organization: null });
    const { load } = await importMod();
    await expect(load(ev({}))).rejects.toMatchObject({ status: 404 });
  });
});

describe('org-detail Profile update action (#394)', () => {
  it('forwards name and urn to updateOrganization — and no longer isVisible (#609)', async () => {
    mockRequest.mockResolvedValueOnce({ updateOrganization: { id: 'org-id-123' } });
    const { actions } = await importMod();
    // #609: even if an `isVisible` field is somehow present, it must not be
    // forwarded — the flag is system-managed, not user-editable here.
    const result = await actions.update(actionEv({ name: 'Renamed', urn: 'renamed.com', isVisible: 'on' }));
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Changes saved.' });
    expect(superFormFrom(result)?.valid).toBe(true);
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars).toMatchObject({ id: 'org-id-123', name: 'Renamed', urn: 'renamed.com' });
    expect(vars).not.toHaveProperty('isVisible');
  });

  it('strips a scheme/type prefix to the bare slug (guards the #394 cascade corruption)', async () => {
    mockRequest.mockResolvedValueOnce({ updateOrganization: { id: 'org-id-123' } });
    const { actions } = await importMod();
    // A stale/prefixed urn must never reach updateOrganization verbatim — that
    // would store `hrn:org:acme.com` as the org urn and corrupt every child urn.
    await actions.update(actionEv({ name: 'Acme', urn: 'hrn:org:acme.com' }));
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars.urn).toBe('acme.com');
  });

  it('rejects a urn that parses to a non-slug atom with a 400, never calling the mutation', async () => {
    const { actions } = await importMod();
    // parseDisplayUrn would yield `acme::dev` here — a `:`-bearing value that
    // would re-break the rename cascade. validateOrgSlug must reject it.
    const result = await actions.update(actionEv({ name: 'Acme', urn: 'hrn:org:acme::dev' }));
    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'urn')).toEqual(expect.any(String));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('accepts dotted bare org slugs from the shared validator', async () => {
    mockRequest.mockResolvedValueOnce({ updateOrganization: { id: 'org-id-123' } });
    const { actions } = await importMod();
    await actions.update(actionEv({ name: 'Acme', urn: 'acme.com' }));
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars.urn).toBe('acme.com');
  });

  it('returns a 500 fail with an error message when the mutation throws', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const { actions } = await importMod();
    const result = await actions.update(actionEv({ name: 'x', urn: 'y.com' }));
    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'boom' });
  });
});
