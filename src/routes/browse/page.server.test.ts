import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_MEMORIES_QUERY } from '$lib/server/queries';

const mockFetchAllItems = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: vi.fn() }),
}));

vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: mockFetchAllItems,
}));

beforeEach(() => {
  mockFetchAllItems.mockReset();
  mockFetchAllItems.mockResolvedValue([]);
});

async function runLoad() {
  const mod = await import('./+page.server');
  return mod.load({} as any);
}

// The `addToMyMemories` action and the `?addMemory=` sign-up-intent branch this
// file used to cover were removed in #681 — hadron-server#771 retired the
// mutation with spec 048's personal orgs, so both had been failing at runtime.
describe('public browse load', () => {
  it('returns the paginated public memories', async () => {
    mockFetchAllItems.mockResolvedValueOnce([{ id: 'memory-1', name: 'Demo', urn: 'acme.com:demo' }]);

    const res: any = await runLoad();

    expect(mockFetchAllItems).toHaveBeenCalledWith(expect.anything(), PUBLIC_MEMORIES_QUERY, 'memories');
    expect(res.memories).toHaveLength(1);
    expect(res.memories[0].id).toBe('memory-1');
  });

  it('degrades to an empty list when the query fails', async () => {
    mockFetchAllItems.mockRejectedValueOnce(new Error('boom'));

    const res: any = await runLoad();

    expect(res.memories).toEqual([]);
  });

  it('exposes no form actions — the list is read-only', async () => {
    const mod = await import('./+page.server');
    expect((mod as Record<string, unknown>).actions).toBeUndefined();
  });
});
