import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADD_TO_MY_MEMORIES_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
const mockFetchAllItems = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: mockFetchAllItems,
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockFetchAllItems.mockReset();
  mockRequest.mockResolvedValue({});
  mockFetchAllItems.mockResolvedValue([]);
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string>, opts: { token?: string | null } = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    locals: {
      token: Object.hasOwn(opts, 'token') ? opts.token : 'test-token',
      user: { id: 'user-1' },
    },
    request: { formData: async () => fd },
  } as any;
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

async function runAdd(fields: Record<string, string>, opts: { token?: string | null } = {}) {
  const actions = await importActions();
  try {
    return await actions.addToMyMemories!(actionEv(fields, opts));
  } catch (error) {
    return error;
  }
}

describe('marketplace add-to-my-memories action', () => {
  it('redirects to the resolved active org after adding', async () => {
    mockFetchAllItems.mockResolvedValueOnce([
      {
        id: 'org-1',
        name: 'Personal',
        urn: 'hadronmemory.com:personal',
        members: [{ user: { id: 'user-1' } }],
      },
    ]);

    const result = await runAdd({ _kind: 'addMarketplaceMemory', memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 303, location: '/app/orgs/org-1/' });
    expect(mockRequest).toHaveBeenCalledWith(ADD_TO_MY_MEMORIES_MUTATION, { memoryId: 'memory-1' });
  });

  it('adds a selected memory and redirects an org-less user to /app/memories when no active org resolves', async () => {
    const result = await runAdd({ _kind: 'addMarketplaceMemory', memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 303, location: '/app/memories' });
    expect(mockRequest).toHaveBeenCalledWith(ADD_TO_MY_MEMORIES_MUTATION, { memoryId: 'memory-1' });
    expect(mockFetchAllItems).toHaveBeenCalled();
  });

  it('redirects unauthenticated users to signup with the selected memory', async () => {
    const result = await runAdd(
      { _kind: 'addMarketplaceMemory', memoryId: 'memory=1&next=/bad' },
      { token: null },
    );

    expect(result).toMatchObject({ status: 303, location: '/signup?memory=memory%3D1%26next%3D%2Fbad' });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockFetchAllItems).not.toHaveBeenCalled();
  });

  it('rejects an omitted memory id before calling GraphQL', async () => {
    const result = await runAdd({ _kind: 'addMarketplaceMemory' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'memoryId')).toBe('Select a memory.');
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockFetchAllItems).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before calling GraphQL', async () => {
    const result = await runAdd({ _kind: 'addPublicMemory', memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockFetchAllItems).not.toHaveBeenCalled();
  });

  it('returns GraphQL failures as typed Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Could not add memory'));

    const result = await runAdd({ _kind: 'addMarketplaceMemory', memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Could not add memory',
    });
  });
});

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
    expect(res.form).toBeDefined();
  });

  it('degrades to empty sections when the query fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const res: any = await runLoad();
    expect(res.organizations).toEqual({ items: [], total: 0 });
    expect(res.agents).toEqual({ items: [], total: 0 });
    expect(res.memories).toEqual({ items: [], total: 0 });
  });
});
