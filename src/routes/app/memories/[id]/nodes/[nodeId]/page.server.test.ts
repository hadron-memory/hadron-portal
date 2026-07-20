/**
 * Regression test for #234 — breadcrumb ancestor resolution must be scoped
 * to the current memory. Previously the loader called NODE_QUERY by loc
 * (memory-blind), so when two memories the caller can access both had a row
 * at the same loc (e.g. `chats`), the breadcrumb's ancestor href was
 * `memories/<current-mem>/nodes/<foreign-mem-PK>` — pointing at a node from
 * the wrong memory.
 *
 * The fix resolves ancestors against the parent layout's already-filtered
 * `graphNodes` instead of issuing a memory-blind GraphQL lookup.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_QUERY, NODE_REVISIONS_QUERY } from '$lib/server/queries';

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

type BreadcrumbSeg = { label: string; path: string; nodeId: string | null };
type LoadResult = { node: unknown; breadcrumb: BreadcrumbSeg[] };

// SvelteKit's generated PageServerLoad return type widens to `T | void`
// (the `void` half is for loaders that redirect). The happy-path tests
// below never redirect, so narrow at the call site.
async function runLoad(event: Parameters<Awaited<ReturnType<typeof importLoad>>>[0]) {
  const load = await importLoad();
  return (await load(event)) as LoadResult;
}

function loadEvent(opts: {
  // #260: org-less route — the memory id is `params.id` (the old `gid`).
  gid: string;
  nodeId: string;
  parentGraphNodes: Array<{ id: string; memoryId: string; loc: string }>;
}) {
  return {
    params: { id: opts.gid, nodeId: opts.nodeId },
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({
      graphNodes: opts.parentGraphNodes,
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('node-detail load — breadcrumb is memory-scoped (#234)', () => {
  it('resolves ancestor nodeIds from the current memory, not from a foreign memory sharing the loc', async () => {
    // Two memories accessible to the caller both have a `chats` row.
    // Only memory A's row should be reachable from memory A's breadcrumb.
    const memA = 'mem-A';
    const memB = 'mem-B';
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'A-chats-setup-pk', memoryId: memA, loc: 'chats:setup', name: 'setup',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });

    const result = await runLoad(loadEvent({
      gid: memA,
      nodeId: 'A-chats-setup-pk',
      // Foreign B-chats-pk is present in the parent fixture so the loader's
      // memoryId filter is the load-bearing assertion, not the (today)
      // redundant pre-filter at the layout boundary.
      parentGraphNodes: [
        { id: 'A-chats-pk', memoryId: memA, loc: 'chats' },
        { id: 'B-chats-pk', memoryId: memB, loc: 'chats' },
        { id: 'A-chats-setup-pk', memoryId: memA, loc: 'chats:setup' },
      ],
    }));

    const ancestor = result.breadcrumb.find((s) => s.path === 'chats');
    expect(ancestor?.nodeId).toBe('A-chats-pk');
    expect(ancestor?.nodeId).not.toBe('B-chats-pk');
  });

  it('returns null for ancestors that do not exist in this memory (even if they exist in another)', async () => {
    const memA = 'mem-A';
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'A-chats-setup-pk', memoryId: memA, loc: 'chats:setup', name: 'setup',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });

    const result = await runLoad(loadEvent({
      gid: memA,
      nodeId: 'A-chats-setup-pk',
      // Memory A has the leaf but not the `chats` parent — only memory B has
      // a `chats` row, but the breadcrumb must NOT borrow it. The "missing
      // ancestor" UX (the +page.svelte's `+ Create parent node` button) hinges
      // on nodeId being null here.
      parentGraphNodes: [
        { id: 'A-chats-setup-pk', memoryId: memA, loc: 'chats:setup' },
        { id: 'B-chats-pk', memoryId: 'mem-B', loc: 'chats' },
      ],
    }));

    const ancestor = result.breadcrumb.find((s) => s.path === 'chats');
    expect(ancestor?.nodeId).toBeNull();
  });

  it('does NOT issue a NODE_QUERY for ancestor lookup — the parent layout already has the data', async () => {
    const memA = 'mem-A';
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: memA, loc: 'foo:bar:baz', name: 'baz',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    // #512: the loader also lists memories for the Move picker.
    mockRequest.mockResolvedValueOnce({ memories: { items: [], total: 0 } });

    await runLoad(loadEvent({
      gid: memA,
      nodeId: 'leaf-pk',
      parentGraphNodes: [
        { id: 'foo-pk', memoryId: memA, loc: 'foo' },
        { id: 'foo-bar-pk', memoryId: memA, loc: 'foo:bar' },
        { id: 'leaf-pk', memoryId: memA, loc: 'foo:bar:baz' },
      ],
    }));

    // The per-ancestor NODE_QUERY (loc-blind lookup) never runs — ancestors
    // resolve from the parent layout's graphNodes. (The loader makes other
    // requests — the node read + the #512 memory list — so assert the specific
    // query is absent rather than a blanket call count.)
    const usedNodeQuery = mockRequest.mock.calls.some(([doc]) => doc === NODE_QUERY);
    expect(usedNodeQuery).toBe(false);
  });

  it('#512 — returns the Move picker memory list, excluding system-class memories', async () => {
    const memA = 'mem-A';
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: memA, loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({
      memories: {
        items: [
          { id: memA, name: 'Memory A', urn: 'org::a', visibility: 'PRIVATE', class: 'knowledge' },
          { id: 'mem-sys', name: 'System', urn: 'org::sys', visibility: 'PRIVATE', class: 'system' },
        ],
        total: 2,
      },
    });

    const result = (await runLoad(loadEvent({
      gid: memA,
      nodeId: 'leaf-pk',
      parentGraphNodes: [{ id: 'leaf-pk', memoryId: memA, loc: 'foo' }],
    }))) as LoadResult & { memories: Promise<Array<{ id: string }>> };

    // #513: memories is streamed (a promise), so await it before asserting.
    const memories = await result.memories;
    expect(memories.map((m) => m.id)).toEqual([memA]); // 'mem-sys' filtered out
  });

  it('#512 — a failed memory-list fetch degrades to an empty picker (page still loads)', async () => {
    const memA = 'mem-A';
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: memA, loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockRejectedValueOnce(new Error('memories boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = (await runLoad(loadEvent({
      gid: memA,
      nodeId: 'leaf-pk',
      parentGraphNodes: [{ id: 'leaf-pk', memoryId: memA, loc: 'foo' }],
    }))) as LoadResult & { memories: Promise<unknown[]> };

    expect(result.node).toBeTruthy();
    expect(await result.memories).toEqual([]); // streamed; degrades to empty
  });

  it('#529 — streams the node revision history (nodeRevisions), forwarding the node id', async () => {
    const memA = 'mem-A';
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: memA, loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ memories: { items: [], total: 0 } });
    mockRequest.mockResolvedValueOnce({
      nodeRevisions: [
        { id: 'r2', createdAt: '2026-07-02T00:00:00Z', name: 'foo', editedBy: 'u1' },
        { id: 'r1', createdAt: '2026-07-01T00:00:00Z', name: 'foo', editedBy: 'u1' },
      ],
    });

    const result = (await runLoad(loadEvent({
      gid: memA,
      nodeId: 'leaf-pk',
      parentGraphNodes: [{ id: 'leaf-pk', memoryId: memA, loc: 'foo' }],
    }))) as LoadResult & { revisions: Promise<{ ok: boolean; items: Array<{ id: string }> }> };

    const res = await result.revisions;
    expect(res.ok).toBe(true);
    expect(res.items.map((v) => v.id)).toEqual(['r2', 'r1']); // most recent first
    const call = mockRequest.mock.calls.find(([doc]) => doc === NODE_REVISIONS_QUERY);
    expect(call?.[1]).toMatchObject({ nodeRef: 'leaf-pk' });
  });

  it('#529 — a failed revision-history fetch reports ok:false (not a silent empty)', async () => {
    const memA = 'mem-A';
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: memA, loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ memories: { items: [], total: 0 } });
    mockRequest.mockRejectedValueOnce(new Error('history boom'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = (await runLoad(loadEvent({
      gid: memA,
      nodeId: 'leaf-pk',
      parentGraphNodes: [{ id: 'leaf-pk', memoryId: memA, loc: 'foo' }],
    }))) as LoadResult & { revisions: Promise<{ ok: boolean; items: unknown[] }> };

    const res = await result.revisions;
    expect(res.ok).toBe(false); // surfaced as a failure, not an empty history
    expect(res.items).toEqual([]);
  });

  it('#237 — redirects when node.memoryId does not match params.gid (PK-mismatch guard)', async () => {
    // The route is scoped by [gid] but node(ref:) resolves the PK alone.
    // A URL combining memory A's gid with memory B's nodeId was
    // silently rendering memory B's node under memory A's layout.
    // The guard redirects to the correct memory URL.
    mockRequest.mockResolvedValueOnce({
      node: {
        // Node lives in mem-B, but the URL says mem-A. The guard
        // should redirect to mem-B's URL with the same nodeId.
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
      await load(loadEvent({
        gid: 'mem-A',
        nodeId: 'leaf-pk',
        parentGraphNodes: [],
      }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/memories/mem-B/nodes/leaf-pk');
  });

  it('#237 — does NOT redirect when node.memoryId matches params.gid (happy path)', async () => {
    // Sanity check: the guard MUST be a no-op when the URL is
    // internally consistent. If this regresses, every node-detail
    // page load starts throwing 303s in a redirect loop.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo', name: 'foo',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });

    const result = await runLoad(loadEvent({
      gid: 'mem-A',
      nodeId: 'leaf-pk',
      parentGraphNodes: [{ id: 'leaf-pk', memoryId: 'mem-A', loc: 'foo' }],
    }));

    // No redirect — load returns the data shape.
    expect(result.breadcrumb).toBeDefined();
  });
});

/**
 * #235 — content/edges/reorder saves must NOT clear the node's tags.
 *
 * Historical server-side root cause: the (now removed) `upsertNode`
 * resolver defaulted `serializeTags(input.tags ?? [])` — when the portal
 * omitted `tags`, the server wrote `[]`. Its updateNode replacement
 * (hadron-server#460) preserves omitted tags, so the pass-through is no
 * longer load-bearing — but it is still the correct round-trip and these
 * tests pin it so the input shape stays deliberate.
 *
 * Portal-side fix: every save action that already loads the current node
 * passes the existing `tags` through the mutation input. These tests pin
 * the contract per action so a future refactor can't silently regress.
 */
import type { Actions } from './$types';

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEvent(opts: {
  // #260: org-less route — the memory id is `params.id` (the old `gid`).
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
    data?: { form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

describe('node-detail actions — preserve tags on save (#235)', () => {
  it('updateContent: tags are explicitly passed through so the server doesn`t default-clear them', async () => {
    // NODE_BY_ID_QUERY load returns a node with tags. The action must
    // include those same tags in the UPDATE_NODE_MUTATION input.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-1', memoryId: 'mem-A', loc: 'instructions', name: 'instructions',
        nodeType: 'info', alias: null, description: null, content: 'old content',
        tokens: null, tags: ['meta', 'onboarding'], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-1' } });

    const actions = await importActions();
    await actions.updateContent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-1',
      form: { content: 'new content' },
    }));

    // Second call is the UPDATE_NODE_MUTATION. Its input must carry the
    // existing tags array verbatim.
    const updateCall = mockRequest.mock.calls[1]!;
    const [, vars] = updateCall as [unknown, { input: { tags?: unknown } }];
    expect(vars.input.tags).toEqual(['meta', 'onboarding']);
  });

  it('updateContent: coalesces a null `node.tags` to [] so a defensive runtime null can`t trigger the server`s ?? [] default', async () => {
    // TypeScript types `MemoryNode.tags` as `string[]` and the GraphQL
    // schema declares `tags: [String!]!`, but the portal-side `?? []`
    // is defensive insurance against a future schema regression or
    // deserializer bug. This test pins that defensive behavior — if
    // someone removes the `?? []` thinking it`s redundant, this fails.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-null', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        // Cast: TS says non-null but we`re testing the belt-and-
        // suspenders coalesce against a runtime null.
        tokens: null, tags: null as unknown as string[], seq: null,
        data: null, ownerRepo: null, isRunnable: null, createdAt: '',
        updatedAt: '', outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-null' } });

    const actions = await importActions();
    await actions.updateContent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-null',
      form: { content: 'x' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { tags?: unknown } }];
    expect(vars.input.tags).toEqual([]);
  });

  it('updateContent: preserves tags even when the node has zero tags (the [] case must round-trip explicitly)', async () => {
    // Subtle: when the node ALREADY has zero tags, we still want to pass
    // `tags: []` through the mutation rather than omit the field. This
    // shields the action from accidentally regressing if someone "cleans
    // up" the explicit pass-through later, thinking it's redundant for
    // empty arrays.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-2', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-2' } });

    const actions = await importActions();
    await actions.updateContent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-2',
      form: { content: 'x' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { tags?: unknown } }];
    expect(vars.input.tags).toEqual([]);
  });

  it('updateEdges: tags are passed through alongside the new edges', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-3', memoryId: 'mem-A', loc: 'src', name: 'src',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: ['kept'], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-3' } });

    const actions = await importActions();
    await actions.updateEdges(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-3',
      form: { edges: JSON.stringify([{ targetId: 'pk-target', name: 'uses' }]) },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { tags?: unknown; edges?: unknown } }];
    expect(vars.input.tags).toEqual(['kept']);
    expect(vars.input.edges).toEqual([{ targetId: 'pk-target', name: 'uses' }]);
  });

  it('updateEdges: returns a typed success message', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-edge-success', memoryId: 'mem-A', loc: 'src', name: 'src',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-edge-success' } });

    const actions = await importActions();
    const result = await actions.updateEdges(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-edge-success',
      form: { edges: '[]' },
    }));

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Edges saved.' });
  });

  it('updateEdges: returns field errors for corrupt edges JSON', async () => {
    const actions = await importActions();
    const result = await actions.updateEdges(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-edge-json',
      form: { edges: '{' },
    }));

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?.edges?.[0]).toBe('Invalid edges JSON');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('updateEdges: rejects tampered action discriminators before any mutation', async () => {
    const actions = await importActions();
    const result = await actions.updateEdges(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-edge-kind',
      form: { _kind: 'updateFlow', edges: '[]' },
    }));

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('updateEdges: returns a typed 404 message when the node is missing', async () => {
    mockRequest.mockResolvedValueOnce({ node: null });

    const actions = await importActions();
    const result = await actions.updateEdges(actionEvent({
      gid: 'mem-A',
      nodeId: 'missing-edge-node',
      form: { edges: '[]' },
    }));

    expect((result as { status: number }).status).toBe(404);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Node not found' });
  });

  it('updateEdges: returns update failures as typed Superforms messages', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-edge-fail', memoryId: 'mem-A', loc: 'src', name: 'src',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockRejectedValueOnce(new Error('edge save exploded'));

    const actions = await importActions();
    const result = await actions.updateEdges(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-edge-fail',
      form: { edges: '[]' },
    }));

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'edge save exploded' });
  });

  it("reorder: each per-loc update preserves the matching node's tags", async () => {
    // reorder iterates updates and updates each one. Each updateNode must
    // carry its own node's tags (NOT a shared blob, NOT empty).
    // First mocked call is the #237 anchor-node fetch; per-loc reads
    // start at index 1.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-anchor', memoryId: 'mem-A', loc: 'a', name: 'anchor',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-a', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: ['a-tag'], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-a' } });
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-b', memoryId: 'mem-A', loc: 'b', name: 'b',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: ['b-tag1', 'b-tag2'], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-b' } });

    const actions = await importActions();
    await actions.reorder(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-anchor',
      form: {
        updates: JSON.stringify([
          { loc: 'a', seq: 1 },
          { loc: 'b', seq: 2 },
        ]),
      },
    }));

    // Call index map: [0] anchor fetch, [1] NODE_QUERY for 'a', [2]
    // update 'a', [3] NODE_QUERY for 'b', [4] update 'b'.
    const [, varsA] = mockRequest.mock.calls[2]! as [unknown, { input: { tags?: unknown } }];
    const [, varsB] = mockRequest.mock.calls[4]! as [unknown, { input: { tags?: unknown } }];
    expect(varsA.input.tags).toEqual(['a-tag']);
    expect(varsB.input.tags).toEqual(['b-tag1', 'b-tag2']);
  });

  it('updateMeta: a checked isRunnable box sends isRunnable: true (#322)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-r', memoryId: 'mem-A', loc: 'r', name: 'r',
        nodeType: 'task', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-r' } });

    const actions = await importActions();
    await actions.updateMeta(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-r',
      // Loc unchanged → no MOVE_NODE_MUTATION, so the update is call index 1.
      form: { name: 'r', loc: 'r', isRunnable: 'true' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { isRunnable?: unknown } }];
    expect(vars.input.isRunnable).toBe(true);
  });

  it('updateMeta: an unchecked isRunnable box sends isRunnable: false (#322)', async () => {
    // An unchecked checkbox submits no field at all. The action must still
    // send an explicit `false`, not omit the field — updateNode preserves
    // omitted fields, so omission would never uncheck the box.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-r2', memoryId: 'mem-A', loc: 'r2', name: 'r2',
        nodeType: 'task', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: true, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-r2' } });

    const actions = await importActions();
    await actions.updateMeta(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-r2',
      form: { name: 'r2', loc: 'r2' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { isRunnable?: unknown } }];
    expect(vars.input.isRunnable).toBe(false);
  });

  it('updateMeta: rejects a missing name before looking up the node', async () => {
    const actions = await importActions();
    const result = (await actions.updateMeta(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-r3',
      form: { loc: 'r3' },
    }))) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?.name?.[0]).toBe('Name is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('updateMeta: rejects a tampered form discriminator before looking up the node', async () => {
    const actions = await importActions();
    const result = (await actions.updateMeta(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-r4',
      form: { _kind: 'deleteNode', name: 'r4', loc: 'r4' },
    }))) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

/**
 * #237 review follow-up — mutating actions must derive memoryId from the
 * fetched node, not from `params.gid`. The load-time URL guard only fires
 * on GETs; form actions run before `load`, so a POST with a stale URL
 * would otherwise mutate / delete / move against the wrong memory.
 *
 * One test per representative action — `updateContent` (the original
 * #235 repro path), `delete` (because its redirect target is also URL-
 * derived), `createParent` (because it didn't previously fetch the
 * anchor node), and `reorder` (because its memoryId fan-out has a wider
 * blast radius). The remaining actions (updateMeta, updateEdges) follow
 * the same shape — the pattern is uniform.
 */
describe('node-detail actions — derive memoryId from fetched node (#237)', () => {
  it('updateContent: mutation uses node.memoryId, not params.gid', async () => {
    // Stale URL says mem-A; node actually lives in mem-B. The update
    // input must carry mem-B, so the user's edit lands on the right row.
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
    await actions.updateContent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk',
      form: { content: 'new' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { memoryId: string } }];
    expect(vars.input.memoryId).toBe('mem-B');
    expect(vars.input.memoryId).not.toBe('mem-A');
  });

  it('delete: DELETE_NODE_MUTATION targets the resolved node PK, and redirect URL points at node.memoryId too', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce(true); // deleteNode returns Boolean

    const actions = await importActions();
    let thrown: unknown;
    try {
      await actions.delete(actionEvent({ gid: 'mem-A', nodeId: 'pk', form: {} }));
    } catch (e) {
      thrown = e;
    }
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { nodeRef: string; hard: boolean }];
    // #542: deleteNode takes the resolved node's PK, not loc+memoryId.
    expect(vars.nodeRef).toBe('pk');
    // #503: no `hard` field in the form → soft delete (the safe default).
    expect(vars.hard).toBe(false);
    // Redirect to mem-B's list, not mem-A's.
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/memories/mem-B/nodes');
  });

  it('delete: hard=true from the form is forwarded to deleteNode (#503)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce(true);

    const actions = await importActions();
    try {
      await actions.delete(actionEvent({ gid: 'mem-B', nodeId: 'pk', form: { hard: 'true' } }));
    } catch { /* redirect */ }

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { nodeRef: string; hard: boolean }];
    expect(vars).toMatchObject({ nodeRef: 'pk', hard: true });
  });

  it('delete: returns a typed 500 message when deleteNode fails', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockRejectedValueOnce(new Error('delete failed'));

    const actions = await importActions();
    const result = (await actions.delete(actionEvent({ gid: 'mem-B', nodeId: 'pk', form: {} }))) as { status: number };

    expect(result.status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'delete failed' });
  });

  it('delete: returns a typed 404 message when the node is missing', async () => {
    mockRequest.mockResolvedValueOnce({ node: null });

    const actions = await importActions();
    const result = (await actions.delete(actionEvent({ gid: 'mem-B', nodeId: 'pk', form: {} }))) as { status: number };

    expect(result.status).toBe(404);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Node not found' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('delete: rejects a tampered form discriminator before looking up the node', async () => {
    const actions = await importActions();
    const result = (await actions.delete(actionEvent({
      gid: 'mem-B',
      nodeId: 'pk',
      form: { _kind: 'moveNode' },
    }))) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('createParent: create uses anchorNode.memoryId, not params.gid', async () => {
    // The form supplies a loc + name; the createNode input's memoryId must match
    // the anchor node's actual memory (so a stale URL gid doesn't
    // create the new parent in the wrong memory).
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-anchor', memoryId: 'mem-B', loc: 'foo:bar', name: 'bar',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ createNode: { id: 'new-parent-pk' } });

    const actions = await importActions();
    const result = await actions.createParent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-anchor',
      form: { loc: 'foo', name: 'foo' },
    }));

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Parent node created.' });
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { memoryId: string } }];
    expect(vars.input.memoryId).toBe('mem-B');
  });

  it('createParent: rejects missing fields before looking up the anchor node', async () => {
    const actions = await importActions();
    const result = (await actions.createParent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-anchor',
      form: { name: 'foo' },
    }))) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?.loc?.[0]).toBe('Missing parent loc.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('createParent: rejects a tampered form discriminator before looking up the anchor node', async () => {
    const actions = await importActions();
    const result = (await actions.createParent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-anchor',
      form: { _kind: 'deleteNode', loc: 'foo', name: 'foo' },
    }))) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('reorder: every per-loc update uses anchorNode.memoryId, not params.gid', async () => {
    // Anchor fetch up front, then a NODE_QUERY + UPDATE per loc.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-anchor', memoryId: 'mem-B', loc: 'foo:a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-a', memoryId: 'mem-B', loc: 'foo:a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-a' } });

    const actions = await importActions();
    await actions.reorder(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-anchor',
      form: { updates: JSON.stringify([{ loc: 'foo:a', seq: 1 }]) },
    }));

    // Calls: [0] anchor fetch, [1] NODE_QUERY for loc 'foo:a', [2] update.
    const [, vars] = mockRequest.mock.calls[2]! as [unknown, { input: { memoryId: string } }];
    expect(vars.input.memoryId).toBe('mem-B');
  });
});

/**
 * #257 slice 1 — updateAbstract inline save. The abstract is the default
 * vector-index source (spec 031/033), edited inline on the detail page just
 * like content. The action must (a) send the abstract through updateNode,
 * (b) preserve tags (#235 guard), and (c) derive memoryId from the fetched
 * node (#237 guard). The raw string is sent verbatim — the server
 * normalizes empty/whitespace-only to null and caps length.
 */
describe('node-detail action — updateAbstract (#257)', () => {
  it('sends the abstract through updateNode while preserving tags and node.memoryId', async () => {
    // Stale URL says mem-A; the node lives in mem-B and carries tags.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, abstract: 'old summary',
        content: 'body', tokens: null, tags: ['kept'], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    await actions.updateAbstract(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk',
      form: { abstract: 'new summary' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [
      unknown,
      { input: { abstract: unknown; tags: unknown; memoryId: string; content?: unknown } },
    ];
    expect(vars.input.abstract).toBe('new summary');
    expect(vars.input.tags).toEqual(['kept']);
    expect(vars.input.memoryId).toBe('mem-B');
    // Content is NOT sent — omitting it preserves the existing body
    // (Prisma treats undefined as no-op), so an abstract edit can't
    // clobber content.
    expect(vars.input.content).toBeUndefined();
  });

  it('sends an empty string when the abstract is cleared (server normalizes to null)', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, abstract: 'something',
        content: null, tokens: null, tags: [], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    await actions.updateAbstract(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk',
      form: { abstract: '' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { abstract: unknown } }];
    expect(vars.input.abstract).toBe('');
  });
});

/**
 * Data tab — updateData inline save. Node.data is a free-form JSON
 * object/value. The action parses the posted editor text and sends the
 * parsed value through updateNode while preserving tags (#235) and deriving
 * memoryId from the fetched node (#237). Malformed, empty, and top-level
 * `null` bodies are rejected with a 400 BEFORE any GraphQL call — Node.data
 * maps to a Prisma `Json?` column that can't be written a bare JS null
 * through this surface, so clearing isn't supported here.
 */
describe('node-detail action — updateData', () => {
  it('parses the JSON and sends the value through updateNode (tags + node.memoryId preserved)', async () => {
    // Stale URL says mem-A; the node lives in mem-B and carries tags.
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-B', loc: 'cor:api:020:03', name: '03',
        nodeType: 'info', alias: null, description: null, abstract: null,
        content: null, tokens: null, tags: ['kept'], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });

    const actions = await importActions();
    await actions.updateData(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk',
      form: { data: '{"version":"0.0.1"}' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [
      unknown,
      { input: { data: unknown; tags: unknown; memoryId: string } },
    ];
    // The parsed object is sent (not the raw string).
    expect(vars.input.data).toEqual({ version: '0.0.1' });
    expect(vars.input.tags).toEqual(['kept']);
    expect(vars.input.memoryId).toBe('mem-B');
  });

  it('rejects malformed JSON with a 400 and never calls updateNode', async () => {
    const actions = await importActions();
    const result = await actions.updateData(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk',
      form: { data: '{ not json ]' },
    }));
    expect((result as { status: number }).status).toBe(400);
    // Parse failure short-circuits before the NODE_BY_ID_QUERY load.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an empty body with a 400 (clearing is unsupported through this surface)', async () => {
    const actions = await importActions();
    const result = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk', form: { data: '   ' },
    }));
    expect((result as { status: number }).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a top-level JSON null with a 400 (Prisma Json? rejects a bare null here)', async () => {
    const actions = await importActions();
    const result = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk', form: { data: 'null' },
    }));
    expect((result as { status: number }).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an oversized payload with a 400 before any GraphQL call', async () => {
    // Well past the 256KB cap — should short-circuit on the size check.
    const big = JSON.stringify({ blob: 'x'.repeat(300_000) });
    const actions = await importActions();
    const result = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk', form: { data: big },
    }));
    expect((result as { status: number }).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns 404 when the node is not found', async () => {
    mockRequest.mockResolvedValueOnce({ node: null });
    const actions = await importActions();
    const result = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'missing', form: { data: '{"a":1}' },
    }));
    expect((result as { status: number }).status).toBe(404);
  });

  it('returns 500 when the update mutation throws', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const actions = await importActions();
    const result = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk', form: { data: '{"a":1}' },
    }));
    expect((result as { status: number }).status).toBe(500);
  });
});
