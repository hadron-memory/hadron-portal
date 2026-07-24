/**
 * #629: /app/dashboard loader. Org members keep the spec-014 (T025 / FR-007) 302
 * to their org overview; consumer / org-less users get simple stats about the
 * memories they own (via fetchOwnedMemories).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.spyOn(console, 'error').mockImplementation(() => {});

const mockFetchOwned = vi.fn();
vi.mock('$lib/server/personal-memories', () => ({
  fetchOwnedMemories: (...a: unknown[]) => mockFetchOwned(...a),
}));

beforeEach(() => mockFetchOwned.mockReset());

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

describe('/app/dashboard loader (#629)', () => {
  it('302s an org member to their org overview (spec-014 T025)', async () => {
    const result = await runLoad({ isConsumerMode: false, activeOrgId: 'org-x' });
    expect(result).toMatchObject({ status: 302, location: '/app/orgs/org-x/' });
    expect(mockFetchOwned).not.toHaveBeenCalled();
  });

  it('renders stats for a consumer (memory list, loadFailed false)', async () => {
    mockFetchOwned.mockResolvedValue([{ id: 'a', name: 'mine' }]);
    const result = await runLoad({ isConsumerMode: true, activeOrgId: 'org-personal' });
    expect(result).toMatchObject({ memories: [{ id: 'a' }], loadFailed: false });
  });

  it('renders stats for an org-less user (no active org — no longer a 303 dead-end)', async () => {
    mockFetchOwned.mockResolvedValue([]);
    const result = await runLoad({ isConsumerMode: false, activeOrgId: null });
    expect(result).toMatchObject({ memories: [], loadFailed: false });
  });

  // The failure path (`loadFailed: true` on a rejected fetch) is the same plain
  // try/catch as /app/memories and is verified in-browser (error banner renders
  // instead of a misleading "0 memories"). A throwing mock trips this repo's
  // vitest error detector even when the loader catches it, so it isn't unit-
  // tested here.
});
