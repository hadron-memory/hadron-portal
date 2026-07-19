import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EFFECTIVE_ACCESS_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({
    effectiveAccess: {
      user: { id: 'user-1', handle: 'holger', name: null, email: null },
      resourceUrn: 'hrn:memory:hadronmemory.com::demo',
      resourceKind: 'memory',
      role: 'OWNER',
      canRead: true,
      canWrite: true,
      canManage: true,
      canDelete: true,
      grants: [],
    },
  });
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    locals: { token: 'test-token' },
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

async function run(fields: Record<string, string>) {
  const actions = await importActions();
  return actions.run!(actionEv(fields));
}

describe('access check command action', () => {
  it('checks access with validated and normalized form data', async () => {
    const result = await run({
      _kind: 'accessCheck',
      user: '@holger',
      resource: 'hrn:memory:hadronmemory.com::demo',
    });

    expect(result).toMatchObject({ result: { resourceKind: 'memory' } });
    expect(superFormFrom(result)).toMatchObject({
      valid: true,
      message: { type: 'success', text: 'Access check complete.' },
    });
    expect(mockRequest).toHaveBeenCalledWith(EFFECTIVE_ACCESS_QUERY, {
      user: 'hrn:user:holger',
      resource: 'hrn:memory:hadronmemory.com::demo',
    });
  });

  it('rejects omitted required fields before calling GraphQL', async () => {
    const result = await run({ _kind: 'accessCheck' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'user')).toBe('Enter a user.');
    expect(fieldError(result, 'resource')).toBe('Enter a resource.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before calling GraphQL', async () => {
    const result = await run({
      _kind: 'mergeNode',
      user: '@holger',
      resource: 'hrn:memory:hadronmemory.com::demo',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns GraphQL failures as typed Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Nope', extensions: { code: 'FORBIDDEN' } }] },
    });

    const result = await run({
      _kind: 'accessCheck',
      user: '@holger',
      resource: 'hrn:memory:hadronmemory.com::demo',
    });

    expect(result).toMatchObject({ status: 403 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: "You're not allowed to audit access to this resource. You can check your own access, or any resource you can see.",
    });
  });
});
