import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
});

// The `addToMyMemories` action this file also used to cover was removed in
// #681 — hadron-server#771 retired the mutation with spec 048's personal orgs,
// so the action had been failing at runtime. Its tests went with it; they had
// been passing against a mock the whole time.
describe('marketplace load — the three catalogue sections (#610 Phase 4b)', () => {
  async function runLoad(token: string | null = 'test-token') {
    const mod = await import('./+page.server');
    return mod.load({ locals: { token, user: { id: 'user-1' } } } as any);
  }

  it('returns organizations / agents / memories sections from MARKETPLACE_QUERY', async () => {
    mockRequest.mockResolvedValueOnce({
      marketplaceOrganizations: { items: [{ id: 'o1', name: 'Org', urn: 'org', description: null }], total: 1 },
      marketplaceAgents: { items: [], total: 0 },
      marketplaceMemories: { items: [{ id: 'm1', name: 'Mem', urn: 'mem', description: 'd' }], total: 3 },
    });
    const res: any = await runLoad();
    expect(res.organizations.items[0].id).toBe('o1');
    expect(res.agents.items).toEqual([]);
    expect(res.memories.total).toBe(3);
  });

  it('degrades to empty sections when the query fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const res: any = await runLoad();
    expect(res.organizations).toEqual({ items: [], total: 0 });
    expect(res.agents).toEqual({ items: [], total: 0 });
    expect(res.memories).toEqual({ items: [], total: 0 });
  });

  it('exposes no form actions — the catalogue is read-only', async () => {
    const mod = await import('./+page.server');
    expect((mod as Record<string, unknown>).actions).toBeUndefined();
  });
});
