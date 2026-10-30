import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_TASKS_APP_QUERY,
  APP_NODES_QUERY,
  APP_QUERY,
  APP_INSTALLED_AGENTS_QUERY,
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
      if (query === APP_QUERY || query === AGENT_TASKS_APP_QUERY) return { app };
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

// portal#1130: a viewer with no access gets the App page's 404, not a 500.
// The server conceals the App (FORBIDDEN on app(ref:)) and its runs (NOT_FOUND
// on appRuns); only those codes become a 404, and any other failure stays a
// failure (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
describe('app runs load(): a no-access viewer (#1130)', () => {
  const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });

  async function loadWith(answer: (query: string) => unknown) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRequest.mockImplementation(async (query: string) => answer(query));
    const { load } = await importServer();
    return load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok' },
      parent: async () => ({}),
      url: new URL('https://example.test/app/apps/app-1/runs'),
    } as unknown as Parameters<typeof load>[0]);
  }

  it('a refused App read (FORBIDDEN) is a 404', async () => {
    await expect(loadWith((q) => {
      if (q === APP_QUERY || q === AGENT_TASKS_APP_QUERY) throw gqlError('FORBIDDEN');
      if (q === APP_RUNS_QUERY) throw gqlError('NOT_FOUND');
      throw gqlError('FORBIDDEN');
    })).rejects.toMatchObject({ status: 404 });
  });

  it('concealed runs (NOT_FOUND on appRuns) are a 404, as the issue observed', async () => {
    await expect(loadWith((q) => {
      if (q === APP_QUERY || q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === APP_RUNS_QUERY) throw gqlError('NOT_FOUND');
      throw gqlError('FORBIDDEN');
    })).rejects.toMatchObject({ status: 404 });
  });

  it('any other failure of the runs read stays a failure, not a 404', async () => {
    await expect(loadWith((q) => {
      if (q === APP_QUERY || q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === APP_RUNS_QUERY) throw gqlError('INTERNAL_SERVER_ERROR');
      return { appNodes: [] };
    })).rejects.not.toMatchObject({ status: 404 });
    await expect(loadWith((q) => {
      if (q === APP_QUERY || q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === APP_RUNS_QUERY) throw new Error('ECONNREFUSED');
      return { appNodes: [] };
    })).rejects.toThrow('ECONNREFUSED');
  });

  it('an App read failing with a server fault stays a failure, not a 404', async () => {
    await expect(loadWith((q) => {
      if (q === APP_QUERY || q === AGENT_TASKS_APP_QUERY) throw gqlError('INTERNAL_SERVER_ERROR');
      return { appRuns: { items: [], total: 0 }, appNodes: [] };
    })).rejects.not.toMatchObject({ status: 404 });
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

// portal#1444 (hadron-server#2849): an App with several installed Agents refuses
// a run that names none (RUN_AGENT_REQUIRED); the page offers a picker and sends agentRef.
describe('app runs: choosing the Agent (#1444)', () => {
  const agent = (n: string) => ({ agent: { id: `ag-${n}`, name: `Agent ${n}`, urn: `hrn:agent:x:${n}` } });
  const gqlError = (code: string, message = 'server prose') => ({ response: { errors: [{ message, extensions: { code } }] } });

  async function loadWith(appAgents: unknown, agentsRead?: () => unknown) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRequest.mockImplementation(async (query: string) => {
      if (query === APP_QUERY || query === AGENT_TASKS_APP_QUERY) return { app };
      if (query === APP_RUNS_QUERY) return { appRuns: { items: [], total: 0 } };
      if (query === APP_NODES_QUERY) return { appNodes: [flowNode] };
      if (query === APP_INSTALLED_AGENTS_QUERY) return agentsRead ? agentsRead() : { app: { id: 'app-1', appAgents } };
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    });
    const { load } = await importServer();
    return (await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok' },
      parent: async () => ({}),
      url: new URL('https://example.test/app/apps/app-1/runs'),
    } as unknown as Parameters<typeof load>[0])) as { runAgents: unknown; runForm: { data: Record<string, unknown> } };
  }

  it('several installed Agents: the loader hands the picker their names', async () => {
    const r = await loadWith([agent('a'), agent('b')]);
    expect(r.runAgents).toEqual([agent('a').agent, agent('b').agent]);
    expect(r.runForm.data.agentRef).toBe('');
  });

  it('one installed Agent: no picker', async () => {
    expect((await loadWith([agent('a')])).runAgents).toBeNull();
  });

  it('a failed Agent read hides the picker, never the page, and is logged', async () => {
    const r = await loadWith(null, () => { throw new Error('boom'); });
    expect(r.runAgents).toBeNull();
    expect(console.warn).toHaveBeenCalled();
  });

  it('sends agentRef when an Agent was chosen', async () => {
    mockRequest.mockResolvedValueOnce({ runTask: 'run-1' });
    const { actions } = await importServer();
    await expect(actions.run(actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry', agentRef: 'ag-b' }) as never)).rejects.toMatchObject({ status: 303 });
    expect(mockRequest).toHaveBeenCalledWith(RUN_TASK_APP_MUTATION, {
      nodeRef: 'hrn:node:acme.com::flows::entry',
      appRef: 'app-1',
      runAsSelf: false,
      agentRef: 'ag-b',
    });
  });

  it('sends no agentRef key when none was chosen (one Agent: the server picks)', async () => {
    mockRequest.mockResolvedValueOnce({ runTask: 'run-1' });
    const { actions } = await importServer();
    await expect(actions.run(actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry', agentRef: '' }) as never)).rejects.toMatchObject({ status: 303 });
    expect(mockRequest.mock.calls[0][1]).not.toHaveProperty('agentRef');
  });

  it('RUN_AGENT_REQUIRED reads as a plain prompt to choose an Agent, never as the code', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('RUN_AGENT_REQUIRED', 'RUN_AGENT_REQUIRED: name one of the installed Agents'));
    const { actions } = await importServer();
    const result = await actions.run(actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry' }) as never);
    const text = (superFormFrom(result)?.message as { text: string }).text;
    expect(text).toMatch(/choose an agent/i);
    expect(text).not.toContain('RUN_AGENT_REQUIRED');
  });
});
