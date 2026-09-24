/**
 * Tasks-tab loader (#845, @copilot on #847).
 *
 * This loader had no test, which #847 made worth fixing rather than noting:
 * it moved off `parent()` onto its own `ORG_TASK_MEMORY_IDS_QUERY`, and the ids
 * that query returns are the SECURITY BOUNDARY for `RUNNABLE_NODES_QUERY` —
 * the server reads an omitted `memoryIds` as "every accessible memory", so an
 * org with none must short-circuit rather than query with an empty set.
 *
 * The empty-org case is therefore pinned in the strong form: not merely that
 * the result is empty, but that the nodes query was never ISSUED. An assertion
 * on the returned rows alone passes just as happily on a global leak that
 * happened to return nothing for this fixture.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_PROPERTIES_READ_QUERY, ORG_TASK_MEMORY_IDS_QUERY, RUNNABLE_NODES_QUERY } from '$lib/server/queries';
import { nodeUpdateDocument } from '$lib/server/nodeKindDoor';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function importLoad() {
  return (await import('./+page.server')).load;
}

function ev(orgId = 'org-1') {
  return {
    params: { id: orgId },
    locals: { token: 'tok' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

/** Route by document: the org slice, then the runnable-nodes search. */
function route(opts: { memories?: Array<{ id: string }>; nodes?: unknown[]; nodesThrow?: boolean }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === ORG_TASK_MEMORY_IDS_QUERY) {
      return { organization: { id: 'org-1', memories: opts.memories ?? [] } };
    }
    if (query === RUNNABLE_NODES_QUERY) {
      if (opts.nodesThrow) throw new Error('boom');
      return { findNodes: { hits: (opts.nodes ?? []).map((node) => ({ node })) } };
    }
    throw new Error(`Unexpected query: ${String(query).slice(0, 40)}`);
  });
}

const node = (id: string, loc: string) => ({
  id,
  memoryId: 'mem-1',
  loc,
  name: `Task ${id}`,
  description: null,
  nodeType: 'task',
  memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:ops', name: 'Ops' },
});

describe('org tasks load()', () => {
  it('fetches the org memory ids itself, not from the layout', async () => {
    route({ memories: [{ id: 'mem-1' }] });
    const load = await importLoad();
    await load(ev());
    expect(mockRequest).toHaveBeenCalledWith(ORG_TASK_MEMORY_IDS_QUERY, { ref: 'org-1' });
  });

  it('scopes the nodes query to exactly the org memory ids', async () => {
    route({ memories: [{ id: 'mem-1' }, { id: 'mem-2' }], nodes: [node('n1', 'tasks:one')] });
    const load = await importLoad();
    await load(ev());
    const call = mockRequest.mock.calls.find(([q]) => q === RUNNABLE_NODES_QUERY);
    expect(call?.[1]).toMatchObject({ memoryIds: ['mem-1', 'mem-2'] });
  });

  it('an org with no memories issues NO nodes query at all', async () => {
    // The security assertion. `nodes()` with an omitted/empty memoryIds is read
    // server-side as "every accessible memory", so short-circuiting is what
    // stops the global task list leaking into an empty org's tab.
    route({ memories: [] });
    const load = await importLoad();
    const result = (await load(ev())) as { tasks: unknown[]; failed: boolean };

    expect(result.tasks).toEqual([]);
    expect(result.failed).toBe(false);
    expect(mockRequest.mock.calls.filter(([q]) => q === RUNNABLE_NODES_QUERY)).toHaveLength(0);
    // …and the org slice WAS fetched, so "issued nothing at all" cannot pass this.
    expect(mockRequest.mock.calls.filter(([q]) => q === ORG_TASK_MEMORY_IDS_QUERY)).toHaveLength(1);
  });

  it('a nodes-query failure degrades to failed:true rather than throwing', async () => {
    route({ memories: [{ id: 'mem-1' }], nodesThrow: true });
    const load = await importLoad();
    const result = (await load(ev())) as { tasks: unknown[]; failed: boolean };
    expect(result.failed).toBe(true);
    expect(result.tasks).toEqual([]);
  });

  it('drops a node whose URN cannot be composed, keeping the rest', async () => {
    const orphan = { ...node('n2', 'tasks:two'), memory: null };
    route({ memories: [{ id: 'mem-1' }], nodes: [node('n1', 'tasks:one'), orphan] });
    const load = await importLoad();
    const result = (await load(ev())) as { tasks: Array<{ id: string; urn: string }> };
    expect(result.tasks.map((t) => t.id)).toEqual(['n1']);
    expect(result.tasks[0].urn).toContain('hrn:node:');
  });
});

// ── #879: the export state on each row, and the row checkbox's action ───────

describe('org tasks load() — #879 export state', () => {
  it('reduces properties to the export state, and never ships the bag itself', async () => {
    const withExport = {
      ...node('n1', 'tasks:one'),
      properties: {
        secret: 'not for the page',
        exports: { claudeSkill: { name: 'one', description: 'd', enable: true } },
      },
    };
    route({ memories: [{ id: 'mem-1' }], nodes: [withExport, node('n2', 'tasks:two')] });
    const load = await importLoad();
    const result = (await load(ev())) as { tasks: Array<Record<string, unknown>> };
    expect(result.tasks[0].export).toEqual({ kind: 'on', hosts: ['claudeSkill'] });
    expect(result.tasks[1].export).toEqual({ kind: 'none' });
    expect(JSON.stringify(result.tasks)).not.toContain('not for the page');
    expect(result.tasks[0]).not.toHaveProperty('properties');
  });

  it('server#1296: a task declared only under a key no host reads carries that fact, bounded', async () => {
    const typo = {
      ...node('n1', 'tasks:one'),
      properties: { exports: { codex: { name: 'one', description: 'd', enable: true } } },
    };
    route({ memories: [{ id: 'mem-1' }], nodes: [typo] });
    const load = await importLoad();
    const result = (await load(ev())) as { tasks: Array<Record<string, unknown>> };
    expect(result.tasks[0].export).toEqual({ kind: 'none', unknown: { count: 1, sample: ['"codex"'] } });
  });
});

async function importActions() {
  return (await import('./+page.server')).actions;
}

function actionEv(fields: Record<string, string>, orgId = 'org-1', token: string | null = 'tok') {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  return {
    request: new Request('http://x/app/orgs/org-1/tasks?/setExport', { method: 'POST', body }),
    params: { id: orgId },
    locals: { token },
  } as unknown as Parameters<Awaited<ReturnType<typeof importActions>>['setExport']>[0];
}

const storedTask = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  memoryId: 'mem-1',
  loc: 'tasks:drive-pr-home',
  name: 'Drive PR home',
  description: 'Take a PR home.',
  isRunnable: true,
  role: null,
  properties: { url: 'kept' },
  ...over,
});

/** Route the action's reads; record every other call as the write. */
function routeAction(opts: { node?: unknown; memories?: Array<{ id: string }>; writeError?: unknown }) {
  const writes: Array<[string, unknown]> = [];
  mockRequest.mockImplementation(async (query: string, vars: unknown) => {
    if (query === NODE_PROPERTIES_READ_QUERY) return { node: opts.node ?? null };
    if (query === ORG_TASK_MEMORY_IDS_QUERY) {
      return { organization: { id: 'org-1', memories: opts.memories ?? [{ id: 'mem-1' }] } };
    }
    writes.push([query, vars]);
    if (opts.writeError) throw opts.writeError;
    return { updateNode: { id: 'n1' } };
  });
  return writes;
}

describe('setExport action — #879', () => {
  it('refuses an anonymous POST before any API call (@copilot on #890)', async () => {
    routeAction({ node: storedTask() });
    const actions = await importActions();
    const out = await actions.setExport(actionEv({ nodeId: 'n1', enable: 'true' }, 'org-1', null));
    expect(out).toMatchObject({ status: 401, data: { exportFailed: { code: 'unauthenticated' } } });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('checking writes BOTH hosts, from the FRESH read, through the node-kind door', async () => {
    const node = storedTask();
    const writes = routeAction({ node });
    const actions = await importActions();
    const out = await actions.setExport(actionEv({ nodeId: 'n1', enable: 'true' }));

    expect(out).toEqual({ exportSaved: { nodeId: 'n1' } });
    expect(writes).toHaveLength(1);
    const input = {
      memoryId: 'mem-1',
      loc: 'tasks:drive-pr-home',
      properties: {
        url: 'kept',
        exports: {
          claudeSkill: { name: 'drive-pr-home', description: 'Take a PR home.', enable: true },
          codexSkill: { name: 'drive-pr-home', description: 'Take a PR home.', enable: true },
        },
      },
    };
    expect(writes[0]).toEqual([nodeUpdateDocument(node as never, input), { input }]);
  });

  it('sends ONLY memoryId, loc and properties — never isRunnable, name or content', async () => {
    const writes = routeAction({ node: storedTask() });
    const actions = await importActions();
    await actions.setExport(actionEv({ nodeId: 'n1', enable: 'true' }));
    const { input } = writes[0][1] as { input: Record<string, unknown> };
    expect(Object.keys(input).sort()).toEqual(['loc', 'memoryId', 'properties']);
  });

  it('unchecking sets enable:false and keeps name, description and the untouched host set', async () => {
    const decl = { name: 'custom', description: 'mine', enable: true };
    const writes = routeAction({ node: storedTask({ properties: { exports: { claudeSkill: decl } } }) });
    const actions = await importActions();
    await actions.setExport(actionEv({ nodeId: 'n1', enable: 'false' }));
    const { input } = writes[0][1] as { input: { properties: unknown } };
    expect(input.properties).toEqual({ exports: { claudeSkill: { ...decl, enable: false } } });
  });

  it('asking for the stored state writes NOTHING', async () => {
    const writes = routeAction({ node: storedTask() });
    const actions = await importActions();
    const out = await actions.setExport(actionEv({ nodeId: 'n1', enable: 'false' }));
    expect(out).toEqual({ exportSaved: { nodeId: 'n1' } });
    expect(writes).toHaveLength(0);
  });

  it('refuses a divergent export and writes nothing', async () => {
    const split = {
      exports: {
        claudeSkill: { name: 'a', description: 'd', enable: true },
        codexSkill: { name: 'a', description: 'd', enable: false },
      },
    };
    const writes = routeAction({ node: storedTask({ properties: split }) });
    const actions = await importActions();
    const out = await actions.setExport(actionEv({ nodeId: 'n1', enable: 'false' }));
    expect(out).toMatchObject({ status: 409, data: { exportFailed: { nodeId: 'n1', code: 'divergent' } } });
    expect(writes).toHaveLength(0);
  });

  it('refuses a node outside this org\'s memories as not-found, and writes nothing', async () => {
    const writes = routeAction({ node: storedTask({ memoryId: 'mem-other' }) });
    const actions = await importActions();
    const out = await actions.setExport(actionEv({ nodeId: 'n1', enable: 'true' }));
    expect(out).toMatchObject({ status: 404, data: { exportFailed: { code: 'not-found' } } });
    expect(writes).toHaveLength(0);
  });

  it('refuses a node that is no longer runnable', async () => {
    const writes = routeAction({ node: storedTask({ isRunnable: false }) });
    const actions = await importActions();
    const out = await actions.setExport(actionEv({ nodeId: 'n1', enable: 'true' }));
    expect(out).toMatchObject({ status: 409, data: { exportFailed: { code: 'not-runnable' } } });
    expect(writes).toHaveLength(0);
  });

  it('refuses a malformed enable value rather than reading it as off', async () => {
    const writes = routeAction({ node: storedTask() });
    const actions = await importActions();
    const out = await actions.setExport(actionEv({ nodeId: 'n1', enable: 'on' }));
    expect(out).toMatchObject({ status: 400, data: { exportFailed: { code: 'invalid' } } });
    expect(writes).toHaveLength(0);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('surfaces a schema refusal (server#1286) with the server\'s own words', async () => {
    const err = Object.assign(new Error('x'), {
      response: { errors: [{ message: 'Unknown property "exports" on strict collection "competitor"', extensions: { code: 'BAD_USER_INPUT' } }] },
    });
    routeAction({ node: storedTask(), writeError: err });
    const actions = await importActions();
    const out = await actions.setExport(actionEv({ nodeId: 'n1', enable: 'true' }));
    expect(out).toMatchObject({ status: 400, data: { exportFailed: { code: 'rejected' } } });
    expect((out as { data: { exportFailed: { detail: string } } }).data.exportFailed.detail).toContain('strict collection');
  });
});
