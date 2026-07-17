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
    parent: async () => ({ org: fakeOrg }),
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
  it('forwards the parent org and the current user id', async () => {
    const { load } = await importMod();
    const result = await load(ev({ orgId: 'org-id-123', userId: 'user-1' }));
    expect(result).toMatchObject({ org: fakeOrg, currentUserId: 'user-1' });
    expect((result as { form: { valid: boolean } }).form.valid).toBe(true);
  });

  it('null currentUserId when there is no logged-in user', async () => {
    const { load } = await importMod();
    const result = await load(ev({ userId: null }));
    expect(result).toMatchObject({ org: fakeOrg, currentUserId: null });
  });

  it('issues no GraphQL request of its own (org comes from parent())', async () => {
    const { load } = await importMod();
    await load(ev({}));
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('org-detail Profile update action (#394)', () => {
  it('forwards name and urn to updateOrganization — and no longer isVisible (#609)', async () => {
    mockRequest.mockResolvedValueOnce({ updateOrganization: { id: 'org-id-123' } });
    const { actions } = await importMod();
    // #609: even if an `isVisible` field is somehow present, it must not be
    // forwarded — the flag is system-managed, not user-editable here.
    const result = await actions.update(actionEv({ name: 'Renamed', urn: 'renamed', isVisible: 'on' }));
    expect(superFormFrom(result)?.message).toBe('Changes saved.');
    expect(superFormFrom(result)?.valid).toBe(true);
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars).toMatchObject({ id: 'org-id-123', name: 'Renamed', urn: 'renamed' });
    expect(vars).not.toHaveProperty('isVisible');
  });

  it('strips a scheme/type prefix to the bare slug (guards the #394 cascade corruption)', async () => {
    mockRequest.mockResolvedValueOnce({ updateOrganization: { id: 'org-id-123' } });
    const { actions } = await importMod();
    // A stale/prefixed urn must never reach updateOrganization verbatim — that
    // would store `hrn:org:acme` as the org urn and corrupt every child urn.
    await actions.update(actionEv({ name: 'Acme', urn: 'hrn:org:acme' }));
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars.urn).toBe('acme');
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
    const result = await actions.update(actionEv({ name: 'x', urn: 'y' }));
    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toBe('boom');
  });
});
