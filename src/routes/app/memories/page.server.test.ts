/**
 * #627: /app/memories index loader. Org members keep the spec-014 (T009 / FR-008)
 * redirect to their org grid; consumer / org-less users instead get a list of the
 * memories they own (org-less), with org-owned memories filtered out.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.spyOn(console, 'error').mockImplementation(() => {});

const mockFetchAll = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: vi.fn() }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: (...a: unknown[]) => mockFetchAll(...a) }));

beforeEach(() => mockFetchAll.mockReset());

async function importLoad() {
  return (await import('./+page.server')).load;
}

function ev(parentData: Record<string, unknown>) {
  return {
    parent: async () => parentData,
    locals: { token: 't' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

async function runLoad(parentData: Record<string, unknown>) {
  const load = await importLoad();
  try {
    return await load(ev(parentData));
  } catch (e) {
    return e; // redirect throws
  }
}

describe('/app/memories index loader (#627)', () => {
  it('302s an org member to their active org memories grid (spec-014 T009)', async () => {
    const result = await runLoad({ isConsumerMode: false, activeOrgId: 'org-x' });
    expect(result).toMatchObject({ status: 302, location: '/app/orgs/org-x/memories' });
    expect(mockFetchAll).not.toHaveBeenCalled();
  });

  it("lists a consumer user's org-less memories (filters out org-owned ones)", async () => {
    mockFetchAll.mockResolvedValue([
      { id: 'a', name: 'mine', organizationId: null },
      { id: 'b', name: 'org one', organizationId: 'org-9' },
    ]);
    const result = await runLoad({ isConsumerMode: true, activeOrgId: 'org-personal' });
    expect(result).toMatchObject({ memories: [{ id: 'a' }] });
    expect((result as { memories: unknown[] }).memories).toHaveLength(1);
  });

  it('lists memories for an org-less user (no active org — no longer a 303 dead-end)', async () => {
    mockFetchAll.mockResolvedValue([{ id: 'a', name: 'mine', organizationId: null }]);
    const result = await runLoad({ isConsumerMode: false, activeOrgId: null });
    expect(result).toMatchObject({ memories: [{ id: 'a' }], loadFailed: false });
  });

  // NOTE: the loader's failure path (`loadFailed: true` on a rejected fetch) is a
  // plain try/catch and is verified in-browser (the error banner renders instead
  // of the empty state). It isn't unit-tested here because a rejected-promise
  // mock trips vitest 4.x's unhandled-rejection detector even when the loader
  // catches it — surfacing a false failure rather than exercising the branch.
});
