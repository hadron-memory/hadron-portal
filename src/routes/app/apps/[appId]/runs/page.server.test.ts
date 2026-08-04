import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_NODES_QUERY,
  APP_QUERY,
  APP_RUNS_QUERY,
  RUN_TASK_APP_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$app/navigation', () => ({
  beforeNavigate: () => {},
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));
vi.mock('$app/forms', () => ({
  applyAction: vi.fn(),
  deserialize: vi.fn(),
  enhance: () => ({}),
}));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      url: new URL('https://example.test/app/orgs/org-1/apps/app-1/runs'),
      params: {},
      route: { id: null },
      status: 200,
      error: null,
      data: {},
      form: null,
    }),
  };
});

beforeEach(() => {
  mockRequest.mockReset();
});

const app = { id: 'app-1', name: 'Digest', organizationId: 'org-1' };
const flowNode = {
  id: 'node-1',
  name: 'Entry',
  urn: 'hrn:node:acme.com::flows::entry',
  loc: 'flows:entry',
  memoryId: 'memory-1',
  isRunnable: true,
  edges: [],
};

async function importServer() {
  return import('./+page.server');
}

function actionEvent(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    request: { formData: async () => fd },
    params: { id: 'org-1', appId: 'app-1' },
    locals: { token: 'tok' },
  };
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message } };
    form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message };
  } | undefined)?.form;
}

describe('app runs load()', () => {
  it('returns runs, flows, and a seeded run Superform', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === APP_QUERY) return { app };
      if (query === APP_RUNS_QUERY) return { appRuns: { items: [], total: 0 } };
      if (query === APP_NODES_QUERY) return { appNodes: [flowNode] };
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    });
    const { load } = await importServer();

    const result = await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok' },
      parent: async () => ({}),
      url: new URL('https://example.test/app/orgs/org-1/apps/app-1/runs'),
    } as unknown as Parameters<typeof load>[0]) as {
      runForm: { data: { _kind: string; entryUrn: string } };
      page: number;
      total: number;
    };

    expect(result.page).toBe(1);
    expect(result.total).toBe(0);
    expect(result.runForm.data).toMatchObject({
      _kind: 'runFlow',
      entryUrn: '',
    });
  });
});

describe('app runs run action', () => {
  it('starts a flow and redirects to the run detail', async () => {
    mockRequest.mockResolvedValueOnce({ runTask: 'run-1' });
    const { actions } = await importServer();

    await expect(actions.run(actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry' }) as never)).rejects.toMatchObject({
      status: 303,
      location: '/app/apps/app-1/runs/run-1',
    });
    expect(mockRequest).toHaveBeenCalledWith(RUN_TASK_APP_MUTATION, {
      nodeRef: 'hrn:node:acme.com::flows::entry',
      appRef: 'app-1',
      runAsSelf: false,
    });
  });

  it('rejects missing entry urns before starting a flow', async () => {
    const { actions } = await importServer();

    const result = await actions.run(actionEvent({}) as never);

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?.entryUrn?.[0]).toBe('Flow entry node is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects run POSTs with the wrong form discriminator', async () => {
    const { actions } = await importServer();

    const result = await actions.run(actionEvent({
      _kind: 'cancelRun',
      entryUrn: 'hrn:node:acme.com::flows::entry',
    }) as never);

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when starting the flow fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('runner unavailable'));
    const { actions } = await importServer();

    const result = await actions.run(actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry' }) as never);

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'runner unavailable',
    });
  });
});
