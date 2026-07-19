import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADD_TO_MY_MEMORIES_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: vi.fn().mockResolvedValue([]),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
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

describe('public browse add-to-my-memories action', () => {
  it('adds a selected memory and redirects authenticated users to the dashboard', async () => {
    const result = await runAdd({ _kind: 'addPublicMemory', memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 303, location: '/app/dashboard' });
    expect(mockRequest).toHaveBeenCalledWith(ADD_TO_MY_MEMORIES_MUTATION, { memoryId: 'memory-1' });
  });

  it('redirects unauthenticated users to signup with the selected memory', async () => {
    const result = await runAdd(
      { _kind: 'addPublicMemory', memoryId: 'memory-1' },
      { token: null },
    );

    expect(result).toMatchObject({ status: 303, location: '/signup?memory=memory-1' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an omitted memory id before calling GraphQL', async () => {
    const result = await runAdd({ _kind: 'addPublicMemory' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'memoryId')).toBe('Select a memory.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before calling GraphQL', async () => {
    const result = await runAdd({ _kind: 'addMarketplaceMemory', memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns GraphQL failures as typed Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('Could not add memory'));

    const result = await runAdd({ _kind: 'addPublicMemory', memoryId: 'memory-1' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Could not add memory',
    });
  });
});
