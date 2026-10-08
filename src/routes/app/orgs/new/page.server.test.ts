import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importActions>>['default']>>[0];
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

async function runCreate(fields: Record<string, string>) {
  const actions = await importActions();
  try {
    return await actions.default!(actionEv(fields));
  } catch (e) {
    return e;
  }
}

describe('create organization action', () => {
  it('rejects a full org URN before calling the API', async () => {
    const result = await runCreate({ name: 'Acme', urn: 'hrn:org:acme' });
    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'urn')).toEqual(expect.stringContaining('bare slug'));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an empty org URN with a field error before calling the API', async () => {
    const result = await runCreate({ name: 'Acme', urn: '' });
    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'urn')).toBe('Organization URN is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('accepts dotted bare org slugs from the shared validator', async () => {
    mockRequest.mockResolvedValueOnce({ createOrganization: { id: 'org-1' } });
    await runCreate({ name: 'Acme', urn: 'acme.com' });
    const [, vars] = mockRequest.mock.calls[0]!;
    expect(vars).toMatchObject({ name: 'Acme', urn: 'acme.com' });
  });
});
