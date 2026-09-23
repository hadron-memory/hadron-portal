/**
 * #237 regression — the edit route carries the same URL-acceptance guard
 * as the detail page. Without it, a mismatched `(gid, nodeId)` URL would
 * let the user save changes into a foreign-memory node while believing
 * they edit the current memory's row. Test pins the redirect to the
 * correct edit URL.
 *
 * Strategy mirrors the detail page's page.server.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

// #260: org-less route — the memory id is `params.id` (the old `gid`).
function loadEvent(opts: { gid: string; nodeId: string }) {
  return {
    params: { id: opts.gid, nodeId: opts.nodeId },
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('edit-node load — #237 PK-mismatch guard', () => {
  it("redirects to the correct memory's edit URL when node.memoryId does not match params.gid", async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: 'mem-B', loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });

    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(loadEvent({ gid: 'mem-A', nodeId: 'leaf-pk' }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/memories/mem-B/nodes/leaf-pk/edit');
  });

  it('does NOT redirect when node.memoryId matches params.gid (happy path)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });

    const load = await importLoad();
    const result = await load(loadEvent({ gid: 'mem-A', nodeId: 'leaf-pk' }));
    // SvelteKit's PageServerLoad return type widens to `T | void`; the
    // void half is the redirect path. Happy path here returns data.
    expect(result).toBeDefined();
    expect((result as { node: { id: string } }).node.id).toBe('leaf-pk');
    expect((result as { form: { data: Record<string, unknown>; errors: Record<string, string[]> } }).form.data).toEqual({
      isRunnable: false,
      objectType: '',
      propertiesJson: '',
    });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
    expect((result as { runnableBlockedBy: unknown }).runnableBlockedBy).toBeNull();
  });

  it.each([
    ['review', 'review'],
    ['spec', 'spec'],
  ])('reports that a %s node cannot be made runnable here (@copilot on #887)', async (role, expected) => {
    // Asked of the same door chooser the save uses: a runnable review/spec
    // matches two governed kinds and has no single write door.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'foo', role,
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    const load = await importLoad();
    const result = await load(loadEvent({ gid: 'mem-A', nodeId: 'leaf-pk' }));
    expect((result as { runnableBlockedBy: unknown }).runnableBlockedBy).toBe(expected);
    // Not yet runnable, so it can still be written — just not made runnable.
    expect((result as { noWriteDoor: unknown }).noWriteDoor).toBeNull();
  });

  it('reports NO write door for a review node that is ALREADY runnable (@copilot on #887)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'foo', role: 'review',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: true, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    const load = await importLoad();
    const result = await load(loadEvent({ gid: 'mem-A', nodeId: 'leaf-pk' }));
    expect((result as { noWriteDoor: unknown }).noWriteDoor).toMatch(/no single write path/);
  });
});

/**
 * #237 review follow-up — the `default` action runs BEFORE `load`, so
 * the URL-time guard above doesn't fire on POST. Action must derive
 * memoryId from the fetched node (not from params.gid) so a stale-URL
 * submission commits to the right memory.
 */
import type { Actions } from './$types';

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEvent(opts: {
  gid: string;
  nodeId: string;
  form: Record<string, string>;
}) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(opts.form)) formData.append(k, v);
  return {
    params: { id: opts.gid, nodeId: opts.nodeId },
    locals: { token: 'tok' },
    request: { formData: async () => formData },
  } as unknown as Parameters<Actions[keyof Actions]>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

describe('edit-node default action — derives memoryId from fetched node (#237)', () => {
  it("update input.memoryId is the node's actual memoryId, not params.gid", async () => {
    // Stale URL says mem-A; the node lives in mem-B. The update must
    // commit into mem-B so the user's edit lands on the right row.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: 'old',
        tokens: null, tags: ['x'], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    let thrown: unknown;
    try {
      await actions.default(actionEvent({ gid: 'mem-A', nodeId: 'pk', form: { objectType: '' } }));
    } catch (e) {
      thrown = e;
    }
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { memoryId: string; loc: string } }];
    expect(vars.input.memoryId).toBe('mem-B');
    // The selector is the node's CURRENT loc — this page never moves a node.
    expect(vars.input.loc).toBe('a');
    // Post-action redirect URL should point at mem-B too.
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/memories/mem-B/nodes/pk');
  });

  /**
   * #878 — the page lost its Metadata, Edges, Abstract and Content sections
   * (each has its own tab on the node page). `UpdateNodeInput` preserves an
   * omitted field, so the action must OMIT every one of them. Sending them —
   * even a hand-built POST that includes them — would clear or overwrite a
   * value the page no longer shows.
   */
  it('sends ONLY objectType and properties — never a field edited on another tab', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'Stored name',
        nodeType: 'info', alias: 'al', description: 'stored', content: 'stored body',
        abstract: 'stored abstract', tokens: null, tags: ['x'], seq: 4, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    try {
      await actions.default(actionEvent({
        gid: 'mem-B',
        nodeId: 'pk',
        // A stale or hand-built POST carrying the retired fields.
        form: {
          name: '', loc: 'moved', description: '', content: '', abstract: '',
          tags: '', seq: '9', edges: '[]', objectType: 'thing', propertiesJson: '{"k":1}',
        },
      }));
    } catch { /* redirect at end */ }

    expect(mockRequest).toHaveBeenCalledTimes(2); // refetch + update: no move
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: Record<string, unknown> }];
    expect(Object.keys(vars.input).sort()).toEqual(['loc', 'memoryId', 'objectType', 'properties']);
    expect(vars.input).toEqual({ memoryId: 'mem-B', loc: 'a', objectType: 'thing', properties: { k: 1 } });
  });

  it('sends isRunnable only as TRUE, never false', async () => {
    // The skill-export checkbox turns Runnable ON; nothing on this page turns
    // it off. Sending the loaded `false` back would let a stale page un-set it.
    async function inputFor(form: Record<string, string>) {
      mockRequest.mockReset();
      mockRequest.mockResolvedValueOnce({
        node: {
          id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a', nodeType: 'info',
          alias: null, description: null, content: null, tokens: null, tags: [],
          seq: null, data: null, ownerRepo: null, isRunnable: true,
          createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
        },
      });
      mockRequest.mockResolvedValueOnce({ updateTaskNode: { id: 'pk' } });
      const actions = await importActions();
      try {
        await actions.default(actionEvent({ gid: 'mem-B', nodeId: 'pk', form }));
      } catch { /* redirect */ }
      return (mockRequest.mock.calls[1]! as [unknown, { input: Record<string, unknown> }])[1].input;
    }

    expect((await inputFor({ isRunnable: 'true' })).isRunnable).toBe(true);
    expect('isRunnable' in (await inputFor({ isRunnable: 'false' }))).toBe(false);
    expect('isRunnable' in (await inputFor({}))).toBe(false);
  });

  it('returns update failures as typed Superforms messages', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: 'old',
        tokens: null, tags: ['x'], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockRejectedValueOnce(new Error('save exploded'));

    const actions = await importActions();
    const result = await actions.default(actionEvent({ gid: 'mem-A', nodeId: 'pk', form: {} }));

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'save exploded' });
  });
  // #588: structured storage — objectType + properties forwarding.
  it('forwards objectType and parsed properties, and seeds them from the node', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        memory: { id: 'mem-B', urn: 'acme.com::brain', name: 'Brain' },
        nodeType: 'record', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        objectType: 'competitor', properties: { name: 'Old' },
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    try {
      await actions.default(actionEvent({
        gid: 'mem-B',
        nodeId: 'pk',
        form: {
          objectType: 'competitor',
          propertiesJson: '{"name": "Acme", "fundingUsd": 5}',
        },
      }));
    } catch { /* redirect at end */ }

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: Record<string, unknown> }];
    expect(vars.input.objectType).toBe('competitor');
    expect(vars.input.properties).toEqual({ name: 'Acme', fundingUsd: 5 });
  });

  it('clears objectType and properties with null when submitted empty', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        memory: { id: 'mem-B', urn: 'acme.com::brain', name: 'Brain' },
        nodeType: 'record', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        objectType: 'competitor', properties: { name: 'Old' },
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    try {
      await actions.default(actionEvent({
        gid: 'mem-B',
        nodeId: 'pk',
        form: { objectType: '', propertiesJson: '' },
      }));
    } catch { /* redirect at end */ }

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: Record<string, unknown> }];
    // null (not undefined) — updateNode treats omit as preserve, null as
    // clear; the resolver maps null properties through jsonOrDbNull.
    expect(vars.input.objectType).toBeNull();
    expect(vars.input.properties).toBeNull();
  });

  it('maps schema violations (BAD_USER_INPUT) to a propertiesJson field error (#588)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        memory: { id: 'mem-B', urn: 'acme.com::brain', name: 'Brain' },
        nodeType: 'record', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{
          message: 'properties.name: required field missing',
          extensions: { code: 'BAD_USER_INPUT' },
        }],
      },
    });

    const actions = await importActions();
    const result = await actions.default(actionEvent({
      gid: 'mem-B',
      nodeId: 'pk',
      form: { objectType: 'competitor', propertiesJson: '{"fundingUsd": 5}' },
    }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'propertiesJson')).toBe('properties.name: required field missing');
  });
});

/**
 * #864 / server #1201 — the TASK KIND DOOR.
 *
 * A runnable node is a governed kind and the generic `updateNode` refuses to
 * produce one. The server decides by the RESULTING state, so editing a node
 * that ALREADY carries the kind is refused too, "even when the edit touches
 * neither signal".
 *
 * Measured in the running app before this landed: the edit page's Runnable
 * checkbox never persisted, and saving any existing task node failed with
 *
 *   "This write would produce a RUNNABLE node, which only updateTaskNode may
 *    update."
 *
 * surfaced as a generic error on the properties field. So the portal could not
 * edit a task node at all — which also made #864's export UI unreachable, since
 * every node it targets is one.
 *
 * These pin the ROUTING, which is the whole of the fix: same input, different
 * door.
 *
 * #868: the door is chosen by the shared chooser (`$lib/server/nodeKindDoor`)
 * from the node's kind BEFORE the write unioned with its kind AFTER — not, as
 * #867 had it, from the submitted value alone. One case below was flipped as
 * part of that; it is marked, because it had pinned a refusal as if it were the
 * contract.
 */
describe('edit-node action — the task kind door (#864, server #1201)', () => {
  function nodeRow(over: Record<string, unknown> = {}) {
    return {
      node: {
        id: 'pk', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: 'old',
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [], ...over,
      },
    };
  }

  async function runSave(form: Record<string, string>, row = nodeRow()) {
    mockRequest.mockResolvedValueOnce(row);
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });
    const actions = await importActions();
    try {
      await actions.default(actionEvent({ gid: 'mem-A', nodeId: 'pk', form }));
    } catch {
      /* the action redirects on success */
    }
    const [doc] = mockRequest.mock.calls[1]! as [string, unknown];
    return doc;
  }

  it('routes a RUNNABLE write through updateTaskNode', async () => {
    const doc = await runSave({ isRunnable: 'true' });
    expect(doc).toContain('updateTaskNode');
    expect(doc).not.toContain('updateNode(');
  });

  it('routes a NON-runnable write through the generic updateNode', async () => {
    // The door is not a free upgrade: sending a task write for ordinary prose
    // would claim a governed kind the node does not have.
    const doc = await runSave({});
    expect(doc).toContain('updateNode(');
    expect(doc).not.toContain('updateTaskNode');
  });

  /**
   * #868 established that the door is chosen from the node's kind BEFORE the
   * write unioned with its kind AFTER — so an existing task node is written
   * through updateTaskNode even when the edit touches neither signal. Since
   * #878 this page cannot remove the marker at all (it sends isRunnable only as
   * `true`), so the case that matters here is the untouched one: saving
   * properties on an existing task node must still take the task door.
   */
  it('routes a save of an EXISTING task node through updateTaskNode, without touching isRunnable', async () => {
    const doc = await runSave({}, nodeRow({ isRunnable: true }));
    expect(doc).toContain('updateTaskNode');
    expect(doc).not.toContain('updateNode(');
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: Record<string, unknown> }];
    expect('isRunnable' in vars.input).toBe(false);
  });

  it('carries the SAME input through either door', async () => {
    // updateTaskNode takes UpdateNodeInput too — routing must not quietly drop
    // a field, which is how a "small" door change loses an edit.
    mockRequest.mockResolvedValueOnce(nodeRow());
    mockRequest.mockResolvedValueOnce({ updateTaskNode: { id: 'pk' } });
    const actions = await importActions();
    try {
      await actions.default(actionEvent({
        gid: 'mem-A', nodeId: 'pk',
        form: { isRunnable: 'true', propertiesJson: '{"exports":{"claudeSkill":{"name":"x","description":"d","enable":true}}}' },
      }));
    } catch { /* redirect */ }
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: Record<string, unknown> }];
    expect(vars.input.isRunnable).toBe(true);
    expect(vars.input.properties).toEqual({
      exports: { claudeSkill: { name: 'x', description: 'd', enable: true } },
    });
  });
});
