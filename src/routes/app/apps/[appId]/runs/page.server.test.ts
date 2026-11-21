import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getOperationAST, parse } from 'graphql';
import {
  AGENT_TASKS_APP_QUERY,
  APP_FLOWS_PAGE_QUERY,
  APP_QUERY,
  APP_INSTALLED_AGENTS_QUERY,
  APP_RUNS_QUERY,
  RUN_TASK_APP_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
// portal#1767 row 7: record every token gqlClient receives, so a pin can hold
// the caller-credential contract (the run action must pass locals.token).
const gqlTokens: (string | undefined)[] = [];
vi.mock('$lib/server/api', () => ({
  gqlClient: (token?: string) => { gqlTokens.push(token); return { request: mockRequest }; },
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
  gqlTokens.length = 0;
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

describe('app runs load(): a no-access viewer (#1130)', () => {
  const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });

  async function loadWith(answer: (query: string) => unknown) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRequest.mockImplementation(async (query: string) => answer(query));
    const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
    const load = (event: { url: URL }) => loadAppRunsPage({ request: mockRequest } as never, 'app-1', event.url.searchParams);
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
    })).resolves.toMatchObject({ failed: true });
    await expect(loadWith((q) => {
      if (q === APP_QUERY || q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === APP_RUNS_QUERY) throw new Error('ECONNREFUSED');
      return { appNodes: [] };
    })).resolves.toMatchObject({ failed: true });
  });

  it('an App read failing with a server fault stays a failure, not a 404', async () => {
    await expect(loadWith((q) => {
      if (q === APP_QUERY || q === AGENT_TASKS_APP_QUERY) throw gqlError('INTERNAL_SERVER_ERROR');
      return { appRuns: { items: [], total: 0 }, appNodes: [] };
    })).rejects.not.toMatchObject({ status: 404 });
  });
});

describe('app runs load(): forward-compatible response enums (#1766)', () => {
  // The rows below carry enum members the CURRENT server schema cannot emit —
  // deliberately. That is the contract #1766 implements: a portal older than
  // its server must still render the page. Every other field copies the real
  // APP_RUNS_QUERY response shape, so only the enum is hypothetical.
  const gqlRow = (id: string, over: Record<string, unknown> = {}) => ({
    id, status: 'COMPLETED', triggerKind: 'MANUAL', entryNodeUrn: 'hrn:node:acme.com::flows::entry',
    createdAt: '2026-10-01T10:00:00.000Z', startedAt: null, finishedAt: null, failure: null, eventData: null, ...over,
  });

  async function loadRows(items: unknown[], total = items.length) {
    // Scoped and restored: this file's beforeEach only resets mockRequest, so
    // a warn spy left mockImplementation'd here would keep silencing (and
    // recording) warns for every later test in the file.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockRequest.mockImplementation(async (query: string) => {
        if (query === APP_QUERY || query === AGENT_TASKS_APP_QUERY) return { app };
        if (query === APP_RUNS_QUERY) return { appRuns: { items, total } };
        throw new Error(`unexpected query: ${query.slice(0, 60)}`);
      });
      const { loadAppRunsPage } = await import('$lib/server/app-runs-page');
      return await loadAppRunsPage(
        { request: mockRequest } as never,
        'app-1',
        new URL('https://example.test/app/apps/app-1/runs').searchParams,
      );
    } finally {
      warn.mockRestore();
    }
  }

  it('serves every row of a page holding well-shaped unknown status/trigger values', async () => {
    const items = Array.from({ length: 20 }, (_, i) =>
      gqlRow(`r-${i}`, i === 0 ? { status: 'PAUSED' } : i === 1 ? { triggerKind: 'FUTURE_KIND' } : {}));
    const r = await loadRows(items, 20);
    expect(r.failed).toBe(false);
    expect(r.runs).toHaveLength(20);
  });

  it('a malformed row still fails the whole page, serving no runs', async () => {
    const r = await loadRows([gqlRow('bad', { status: 42 })]);
    expect(r.failed).toBe(true);
    expect(r.runs).toEqual([]);
  });
});

describe('app runs legacy panel paging (#1881)', () => {
  it('uses a runnable-only appNodesPage at the requested offset and carries navigation instead of a cap', async () => {
    const pageCalls: Record<string, unknown>[] = [];
    mockRequest.mockImplementation(async (query: string, vars: Record<string, unknown> = {}) => {
      const name = getOperationAST(parse(query))?.name?.value;
      if (query === APP_QUERY || query === AGENT_TASKS_APP_QUERY) return { app };
      if (query === APP_RUNS_QUERY) return { appRuns: { items: [], total: 0 } };
      if (query === APP_INSTALLED_AGENTS_QUERY) return { app: { appAgents: [] } };
      if (name === 'AppFlowsPage') {
        pageCalls.push(vars);
        return { appNodesPage: { items: [], total: 45, hasMore: true } };
      }
      throw new Error(`unexpected query: ${name}`);
    });
    const { load } = await importServer();
    const result = await load({
      request: { method: 'POST' }, params: { appId: 'app-1' }, locals: { token: 'tok' },
      url: new URL('https://example.test/app/apps/app-1/runs?flowsOffset=20'),
    } as never) as { legacyPanel: Record<string, unknown> };
    expect(pageCalls).toEqual([expect.objectContaining({ appRef: 'app-1', limit: 20, offset: 20 })]);
    expect(result.legacyPanel.flowsPage).toMatchObject({ offset: 20, count: 0, total: 45 });
    expect(result.legacyPanel).not.toHaveProperty('flowsCapped');
  });
});

describe('app runs legacy load(): Flows read failure (#2170 F7)', () => {
  async function legacyLoad(flowsPage: () => unknown) {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRequest.mockImplementation(async (query: string) => {
      const name = getOperationAST(parse(query))?.name?.value;
      if (query === APP_QUERY || query === AGENT_TASKS_APP_QUERY) return { app };
      if (query === APP_RUNS_QUERY) return { appRuns: { items: [], total: 0 } };
      if (query === APP_INSTALLED_AGENTS_QUERY) return { app: { appAgents: [] } };
      if (name === 'AppFlowsPage') return flowsPage();
      if (name === 'AppNodes') return { appNodes: [] };
      throw new Error(`unexpected query: ${name}`);
    });
    const { load } = await importServer();
    return await load({
      request: { method: 'POST' }, params: { appId: 'app-1' }, locals: { token: 'tok' },
      url: new URL('https://example.test/app/apps/app-1/runs'),
    } as never) as { legacyPanel: Record<string, unknown> };
  }

  it('reports a failed Flows page read', async () => {
    const result = await legacyLoad(() => { throw new Error('synthetic Flows failure'); });
    expect(result.legacyPanel).toMatchObject({ flows: [], flowsError: true });
  });

  it('reports no Flows error when the read succeeds (control)', async () => {
    const result = await legacyLoad(() => ({ appNodesPage: { items: [], total: 0, hasMore: false } }));
    expect(result.legacyPanel).toMatchObject({ flowsError: false });
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

  // portal#1767 row 7 (`run_token`): the mutation runs on the caller's own
  // credential. Mutant: gqlClient() with no argument — the recording mock then
  // holds undefined and this pin fails on the assertion, not on a crash.
  it('starts the flow as the signed-in caller, an impersonation token included (row 7: gqlClient())', async () => {
    mockRequest.mockResolvedValueOnce({ runTask: 'run-1' });
    const { actions } = await importServer();
    await expect(actions.run(actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry' }) as never)).rejects.toMatchObject({ status: 303 });
    expect(gqlTokens.at(-1)).toBe('tok');

    mockRequest.mockResolvedValueOnce({ runTask: 'run-2' });
    const impersonated = { ...actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry' }), locals: { token: 'imp-personation-tok' } };
    await expect(actions.run(impersonated as never)).rejects.toMatchObject({ status: 303 });
    expect(gqlTokens.at(-1)).toBe('imp-personation-tok');
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
      if (query === APP_FLOWS_PAGE_QUERY) return { appNodesPage: { items: [flowNode], total: 1, hasMore: false } };
      if (query === APP_INSTALLED_AGENTS_QUERY) return agentsRead ? agentsRead() : { app: { id: 'app-1', appAgents } };
      throw new Error(`unexpected query: ${query.slice(0, 60)}`);
    });
    const { loadAppRunsExtras } = await import('$lib/server/app-runs-page');
    return loadAppRunsExtras({ request: mockRequest } as never, 'app-1');
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

  // portal#1454 — a correctable refusal is the reader's input, not a server fault.
  it('RUN_AGENT_REQUIRED answers 400; any other failure to start stays 500', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('RUN_AGENT_REQUIRED', 'RUN_AGENT_REQUIRED: name one of the installed Agents'));
    const { actions } = await importServer();
    const refused = (await actions.run(actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry' }) as never)) as { status: number };
    expect(refused.status).toBe(400);

    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const failed = (await actions.run(actionEvent({ entryUrn: 'hrn:node:acme.com::flows::entry' }) as never)) as { status: number };
    expect(failed.status).toBe(500);
  });
});
