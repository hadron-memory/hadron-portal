/**
 * Tests for the org-detail layout loader (#336). The layout loads the org once
 * for the header/tabs; this is where the missing-org 404 lives now (the Profile
 * and Integrations page loaders pull the org from parent()).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ORGANIZATION_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importLoad() {
  const mod = await import('./+layout.server');
  return mod.load;
}

function ev(opts: { orgId?: string } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: 'test-token' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

const fakeOrg = { id: 'org-id-123', name: 'Acme', urn: 'urn:org:acme', members: [] };

describe('org-detail layout load()', () => {
  it('happy path → returns { org } and queries by id', async () => {
    mockRequest.mockResolvedValue({ organization: fakeOrg });
    const load = await importLoad();
    const result = await load(ev({}));
    expect(result).toEqual({ org: fakeOrg });
    expect(mockRequest).toHaveBeenCalledWith(ORGANIZATION_QUERY, { id: 'org-id-123' });
  });

  it('ORGANIZATION_QUERY throws → 404', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({}));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
    expect((thrown as { body?: { message?: string } }).body?.message).toBe('Organization not found');
  });

  it('organization is null → 404', async () => {
    mockRequest.mockResolvedValue({ organization: null });
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev({}));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(404);
  });
});
