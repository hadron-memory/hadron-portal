import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPS_QUERY,
  DELETE_APP_MUTATION,
  ORGANIZATION_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importServer() {
  return import('./+page.server');
}

function route() {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORGANIZATION_QUERY) {
      return { organization: { id: 'org-1', name: 'Org' } };
    }
    if (query === APPS_QUERY) {
      return {
        apps: {
          items: [{ id: 'app-1', name: 'Demo App', keys: [] }],
          total: 1,
        },
      };
    }
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
}

async function runDelete(fields: Record<string, string>) {
  const { actions } = await importServer();
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return actions.delete({
    request: { formData: async () => fd },
    locals: { token: 'tok' },
  } as unknown as Parameters<(typeof actions)['delete']>[0]);
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message } };
    form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message };
  } | undefined)?.form;
}

describe('org apps load()', () => {
  it('returns apps and seeds the delete Superform', async () => {
    route();
    const { load } = await importServer();

    const result = await load({
      params: { id: 'org-1' },
      locals: { token: 'tok' },
      parent: async () => ({}),
    } as unknown as Parameters<typeof load>[0]) as {
      apps: Array<{ id: string }>;
      deleteForm: { data: { _kind: string; id: string } };
    };

    expect(result.apps).toHaveLength(1);
    expect(result.deleteForm.data).toMatchObject({
      _kind: 'deleteApp',
      id: '',
    });
  });
});

describe('org apps delete action', () => {
  it('deletes an app and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce(true);

    const result = await runDelete({ id: 'app-1' });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'deleteApp', id: 'app-1' },
        message: { type: 'success', text: 'App deleted.' },
      },
    });
    expect(mockRequest).toHaveBeenCalledWith(DELETE_APP_MUTATION, { id: 'app-1' });
  });

  it('rejects missing app ids before deleting', async () => {
    const result = await runDelete({});

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?.id?.[0]).toBe('App ID is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects delete POSTs with the wrong form discriminator', async () => {
    const result = await runDelete({ _kind: 'updateApp', id: 'app-1' });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when deleting fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('cannot delete'));

    const result = await runDelete({ id: 'app-1' });

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'cannot delete',
    });
  });
});
