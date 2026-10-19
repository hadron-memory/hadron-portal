import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPS_QUERY,
  APP_KEYS_QUERY,
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
    if (query === APP_KEYS_QUERY) {
      return { appKeys: [{ id: 'k1' }, { id: 'k2' }] };
    }
    if (query === APPS_QUERY) {
      return {
        apps: {
          items: [{ id: 'app-1', name: 'Demo App' }],
          total: 1,
        },
      };
    }
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
}

/** The org the LAYOUT supplies. #382: the loader reads it from here. */
const PARENT_ORG = { id: 'org-1', name: 'Org from layout' };

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
      parent: async () => ({ org: PARENT_ORG }),
    } as unknown as Parameters<typeof load>[0]) as {
      org: unknown;
      apps: Array<{ id: string }>;
      deleteForm: { data: { _kind: string; id: string } };
    };

    expect(result.apps).toHaveLength(1);
    // portal#1068: the Active keys column's counts are classified reads of their own.
    expect((result as unknown as { keyCounts: unknown }).keyCounts).toEqual({ 'app-1': { kind: 'ok', count: 2 } });
    // #382: `org` comes from the layout. Asserting it is what makes the
    // parent stub load-bearing — with `parent: async () => ({})` this loader
    // returns `org: undefined` and every other assertion here still passes.
    expect((result as unknown as { org: unknown }).org).toBe(PARENT_ORG);
    expect(result.deleteForm.data).toMatchObject({
      _kind: 'deleteApp',
      id: '',
    });
  });
});

describe('org apps load(): key counts for a non-manager (portal#1068)', () => {
  it('a refused count does not empty the App list, and is hidden, not 0', async () => {
    route();
    const base = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation(async (query: string, vars: unknown) => {
      if (query === APP_KEYS_QUERY) throw { response: { errors: [{ message: 'no', extensions: { code: 'FORBIDDEN' } }] } };
      return base(query, vars);
    });
    const { load } = await importServer();
    const result = await load({
      params: { id: 'org-1' },
      locals: { token: 'tok' },
      parent: async () => ({ org: PARENT_ORG }),
    } as unknown as Parameters<typeof load>[0]) as { apps: unknown[]; keyCounts: Record<string, unknown> };
    expect(result.apps).toHaveLength(1);
    expect(result.keyCounts['app-1']).toEqual({ kind: 'hidden' });
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
    expect(mockRequest).toHaveBeenCalledWith(DELETE_APP_MUTATION, { ref: 'app-1' });
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

/**
 * #382 — the loader must NOT re-fetch the organization.
 *
 * `/app/orgs/[id]/+layout.server.ts` already runs ORGANIZATION_QUERY for this
 * same `params.id` on this same request, and this loader used to run it again:
 * two identical round trips per page load.
 *
 * Pinned as an ABSENCE, and an absence is the assertion most likely to pass for
 * the wrong reason — so the companion test above asserts the org still arrives,
 * from the parent. One without the other is satisfied by a loader that returns
 * nothing at all.
 */
describe('org apps load() — the org comes from the layout, not a second query (#382)', () => {
  it('issues no ORGANIZATION_QUERY of its own', async () => {
    route();
    const { load } = await importServer();

    await load({
      params: { id: 'org-1' },
      locals: { token: 'tok' },
      parent: async () => ({ org: PARENT_ORG }),
    } as unknown as Parameters<typeof load>[0]);

    const orgQueries = mockRequest.mock.calls.filter(([q]) => q === ORGANIZATION_QUERY);
    expect(orgQueries).toHaveLength(0);
    // And it still asks for what it actually needs, so "no queries at all"
    // cannot pass this.
    expect(mockRequest.mock.calls.filter(([q]) => q === APPS_QUERY)).toHaveLength(1);
  });
});
