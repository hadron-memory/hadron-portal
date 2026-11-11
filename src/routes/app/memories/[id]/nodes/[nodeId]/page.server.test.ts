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
import { jsonFingerprint } from '$lib/properties-source';
import { MOVE_NODE_MUTATION, NODE_QUERY, NODE_REVISIONS_PAGE_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  // portal#1433: the breadcrumb/children/wikilink reads are answered from the
  // seeded nodes WITHOUT touching `mockRequest`, so the ordered
  // `mockResolvedValueOnce` queue below still lines up with the node read.
  gqlClient: () => ({
    request: (doc: string, vars?: Record<string, unknown>) => {
      const served = reads(doc, vars);
      return served !== undefined ? Promise.resolve(served) : mockRequest(doc, vars);
    },
  }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

let reads = serveMemoryReads([], { id: 'mem-A', urn: 'hrn:mem:acme.com:mem-a' });

beforeEach(() => {
  mockRequest.mockReset();
});

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

type BreadcrumbSeg = { label: string; path: string; nodeId: string | null; title?: string };
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
  parentGraphNodes: Array<{ id: string; memoryId: string; loc: string; name?: string }>;
  /** #761 — incoming query string (`?tab=…`), '' for none. */
  search?: string;
  /** #853 — the memory URN the crumb qualifies ancestor locs against. */
  memoryUrn?: string | null;
}) {
  reads = serveMemoryReads(opts.parentGraphNodes as SeedNode[], {
    id: opts.gid,
    urn: opts.memoryUrn ?? 'hrn:mem:acme.com:mem-a',
  });
  return {
    params: { id: opts.gid, nodeId: opts.nodeId },
    locals: { token: 'tok' },
    url: new URL(
      `http://localhost/app/memories/${opts.gid}/nodes/${opts.nodeId}${opts.search ?? ''}`,
    ),
    parent: vi.fn().mockResolvedValue({
      // #853: the breadcrumb qualifies an ancestor loc into a full node URN
      // from this, exactly as the wikilink resolver already does.
      // `'memoryUrn' in opts`, not `??` — an explicit null is the "the layout
      // could not supply a memory URN" case a test needs to stage, and `??`
      // would quietly replace it with the default and assert nothing.
      graph: 'memoryUrn' in opts
        ? (opts.memoryUrn === null ? null : { urn: opts.memoryUrn })
        : { urn: 'hrn:mem:acme.com:mem-a' },
      isConsumerMode: false,
      activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('node-detail load — the metadata form opens on the node\'s role (#921)', () => {
  it('seeds role AND roleSeed with the stored role, verbatim', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'n1', memoryId: 'mem-A', loc: 'specs:x', name: 'x',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, role: 'spec.feature', createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    const result = (await runLoad(loadEvent({ gid: 'mem-A', nodeId: 'n1', parentGraphNodes: [] }))) as unknown as {
      updateMetaForm: { data: { role: string; roleSeed: string } };
    };
    expect(result.updateMetaForm.data.role).toBe('spec.feature');
    expect(result.updateMetaForm.data.roleSeed).toBe('spec.feature');
  });

  it('seeds an unset role as empty, which the action then omits unless typed into', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'n1', memoryId: 'mem-A', loc: 'x', name: 'x',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, role: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    const result = (await runLoad(loadEvent({ gid: 'mem-A', nodeId: 'n1', parentGraphNodes: [] }))) as unknown as {
      updateMetaForm: { data: { role: string; roleSeed: string } };
    };
    expect(result.updateMetaForm.data).toMatchObject({ role: '', roleSeed: '' });
  });
});

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

  it('#529/#1881 — streams a nodeRevisionsPage page, forwarding the node id', async () => {
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
      nodeRevisionsPage: {
        items: [
          { id: 'r2', createdAt: '2026-07-02T00:00:00Z', name: 'foo', editedBy: 'u1' },
          { id: 'r1', createdAt: '2026-07-01T00:00:00Z', name: 'foo', editedBy: 'u1' },
        ],
        total: 2,
        hasMore: false,
      },
    });

    const result = (await runLoad(loadEvent({
      gid: memA,
      nodeId: 'leaf-pk',
      parentGraphNodes: [{ id: 'leaf-pk', memoryId: memA, loc: 'foo' }],
    }))) as LoadResult & { revisions: Promise<{ ok: boolean; items: Array<{ id: string }> }> };

    const res = await result.revisions;
    expect(res.ok).toBe(true);
    expect(res.items.map((v) => v.id)).toEqual(['r2', 'r1']); // most recent first
    const call = mockRequest.mock.calls.find(([doc]) => doc === NODE_REVISIONS_PAGE_QUERY);
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

  it('#761 — the #237 canonicalization carries the query string', async () => {
    // A link written before the node moved is exactly the link most likely to
    // be an old SHARED deep link with state on it, so the correction must be
    // transparent to that state rather than resetting the reader to the node's
    // default tab. Off the URN resolver's happy path — a URN-resolved node
    // arrives with the server's own memoryId and never reaches this branch —
    // but the same defect, so it gets the same fix.
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
      await load(loadEvent({
        gid: 'mem-A',
        nodeId: 'leaf-pk',
        parentGraphNodes: [],
        search: '?tab=references&highlight=edge-7',
      }));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe(
      '/app/memories/mem-B/nodes/leaf-pk?tab=references&highlight=edge-7',
    );
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
import { MEMORY_NODES_QUERY, MEMORY_EDGES_QUERY } from '$lib/server/queries';
import { serveMemoryReads, type SeedNode } from '$lib/test/serveMemoryReads';

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
      form: { content: 'new content', expectedRevision: '3' },
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
      form: { content: 'x', expectedRevision: '3' },
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
      form: { content: 'x', expectedRevision: '3' },
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

  // #656: the client hides the editor when an outgoing edge points into an
  // unreadable memory, but this REPLACEMENT mutation is the load-bearing guard —
  // it must refuse based on the FRESH refetch (crafted POST, or the edge became
  // unreadable while the editor was open).
  it('updateEdges: refuses when the refetched node has an unreadable outgoing edge', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-x', memoryId: 'mem-A', loc: 'src', name: 'src',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [
          { id: 'e1', name: 'ok', loc: 'src:ok', target: { id: 'pk-t', loc: 't', name: 'T' } },
          { id: 'e2', name: 'hidden', loc: 'src:hidden', target: null },
        ],
        incomingEdges: [],
      },
    });

    const actions = await importActions();
    const result = await actions.updateEdges(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-x',
      form: { edges: JSON.stringify([{ targetId: 'pk-t', name: 'ok' }]) },
    }));

    expect(result).toMatchObject({ status: 400 });
    expect(superFormFrom(result)?.message).toMatchObject({ type: 'error' });
    // Never reached the replacement mutation — only the refetch happened.
    expect(mockRequest).toHaveBeenCalledTimes(1);
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
    // reorder resolves every sibling, then writes them. Each write must carry
    // its OWN node's tags (not a shared blob, not empty).
    //
    // Dispatched on the query rather than sequenced with
    // `mockResolvedValueOnce`. The chain encoded the CALL ORDER — anchor, read
    // a, write a, read b, write b — and #868/#869 split the loop into two
    // passes so every read now precedes every write (a door refused on a later
    // sibling must not leave the earlier ones reordered). A sequencing mock
    // fails that as though the tags pass-through broke, which is not what this
    // test is about.
    const rows: Record<string, Record<string, unknown>> = {
      'pk-anchor': {
        id: 'pk-anchor', memoryId: 'mem-A', loc: 'a', name: 'anchor',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, role: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
      a: {
        id: 'pk-a', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: ['a-tag'], seq: null, data: null, ownerRepo: null,
        isRunnable: null, role: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
      b: {
        id: 'pk-b', memoryId: 'mem-A', loc: 'b', name: 'b',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: ['b-tag1', 'b-tag2'], seq: null, data: null,
        ownerRepo: null, isRunnable: null, role: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    };
    mockRequest.mockImplementation(async (_query: unknown, vars: { ref?: string }) => {
      const row = vars?.ref === undefined ? undefined : rows[vars.ref];
      return row ? { node: row } : { updateNode: { id: 'pk' } };
    });

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

    // The writes are the calls that carry no `ref` — the reads all do.
    const [inputA, inputB] = mockRequest.mock.calls
      .filter(([, vars]) => (vars as { ref?: string } | undefined)?.ref === undefined)
      .map(([, vars]) => (vars as { input: { tags?: unknown } }).input);
    expect(inputA.tags).toEqual(['a-tag']);
    expect(inputB.tags).toEqual(['b-tag1', 'b-tag2']);
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

  it('updateMeta: surfaces a loc move conflict as a field error', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-r5', memoryId: 'mem-A', loc: 'source', name: 'source',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: false, createdAt: '', updatedAt: '',
        memory: { urn: 'hadronmemory.com::portal-test' },
        outgoingEdges: [], incomingEdges: [],
      },
    });
    // @codex on #929: the metadata update runs FIRST (by id), the move after.
    mockRequest.mockImplementationOnce(async (query: string) => {
      expect(query).not.toBe(MOVE_NODE_MUTATION);
      return { updateNode: { id: 'pk-r5' } };
    });
    mockRequest.mockImplementationOnce(async (query: string) => {
      expect(query).toBe(MOVE_NODE_MUTATION);
      throw {
        response: {
          errors: [
            {
              message: 'Target loc is already occupied',
              extensions: { code: 'NODE_ALREADY_EXISTS' },
            },
          ],
        },
      };
    });

    const actions = await importActions();
    const result = (await actions.updateMeta(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-r5',
      form: { name: 'source', loc: 'target' },
    }))) as { status: number };

    expect(result.status).toBe(409);
    // The other edits are already saved by then, and the error says so.
    expect(superFormFrom(result)?.errors?.loc?.[0]).toBe('Saved, but the node was not moved: Target loc is already occupied');
    expect(mockRequest).toHaveBeenCalledTimes(3);
    // …and it flags the partial save, so the page reloads the node (@codex on #929).
    expect((result as unknown as { data: { metaSaved?: boolean } }).data.metaSaved).toBe(true);
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
      form: { content: 'new', expectedRevision: '3' },
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
      form: { abstract: 'new summary', expectedRevision: '3' },
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
      form: { abstract: '', expectedRevision: '3' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { abstract: unknown } }];
    expect(vars.input.abstract).toBe('');
  });
});

/**
 * Data tab — updateData (#894). Node.data is any JSON value except a top-level
 * `null` (Prisma `Json?` cannot be written a bare null through this surface).
 * The action validates with the checker shared with the Properties editor,
 * refuses a save whose baseline FINGERPRINT no longer matches the stored
 * value, writes through the node's kind door preserving tags (#235) with
 * memoryId from the fetched node (#237), and returns failures as CODES under
 * `dataFailed` — the old version returned prose the page dropped into
 * console.error, so every refusal looked like nothing happened.
 */
describe('node-detail action — updateData', () => {
  const dataNode = (over: Record<string, unknown> = {}) => ({
    node: {
      id: 'pk', memoryId: 'mem-B', loc: 'cor:api:020:03', tags: ['kept'],
      data: null, isRunnable: null, role: null, ...over,
    },
  });
  // Data's fingerprint is STRICT about null (@codex on #896): absent data and
  // `{}` are different states, so the page posts, and the action checks,
  // with nullIsEmpty: false.
  const dataFp = (v: unknown) => jsonFingerprint(v, { nullIsEmpty: false });
  const failed = (r: unknown) => (r as { status: number; data: { dataFailed: { code: string; detail: string | null } } });

  it('sends the parsed value through the door (tags + node.memoryId preserved)', async () => {
    // Stale URL says mem-A; the node lives in mem-B and carries tags.
    mockRequest.mockResolvedValueOnce(dataNode());
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });
    const actions = await importActions();
    const out = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk',
      form: { data: '{"version":"0.0.1"}', baseline: await dataFp(null) },
    }));
    expect(out).toEqual({ dataSaved: true });
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: Record<string, unknown> }];
    expect(vars.input).toEqual({ memoryId: 'mem-B', loc: 'cor:api:020:03', tags: ['kept'], data: { version: '0.0.1' } });
  });

  it('accepts any JSON value but a top-level null — an array, a scalar', async () => {
    for (const data of ['[1, 2]', '"text"', '42', 'true']) {
      mockRequest.mockReset();
      mockRequest.mockResolvedValueOnce(dataNode());
      mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });
      const actions = await importActions();
      const out = await actions.updateData(actionEvent({
        gid: 'mem-A', nodeId: 'pk', form: { data, baseline: await dataFp(null) },
      }));
      expect(out).toEqual({ dataSaved: true });
    }
  });

  it.each([
    ['malformed JSON', '{ not json ]', 'invalid-json'],
    ['an empty body (clearing is unsupported here)', '   ', 'empty'],
    ['a top-level null', 'null', 'top-level-null'],
    ['a number JSON cannot carry back', '{"n": 1e400}', 'unsafe-number'],
    ['a duplicate key', '{"a": 1, "a": 2}', 'duplicate-key'],
  ])('refuses %s with a code, before any GraphQL call', async (_what, data, code) => {
    const actions = await importActions();
    const out = await actions.updateData(actionEvent({ gid: 'mem-A', nodeId: 'pk', form: { data, baseline: await dataFp(null) } }));
    expect(failed(out).status).toBe(400);
    expect(failed(out).data.dataFailed.code).toBe(code);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('caps the size in UTF-8 BYTES — multibyte text under the cap in characters is still refused', async () => {
    const big = JSON.stringify({ blob: '語'.repeat(100_000) }); // ~100K chars, ~300 KB
    expect(big.length).toBeLessThan(262144);
    const actions = await importActions();
    const out = await actions.updateData(actionEvent({ gid: 'mem-A', nodeId: 'pk', form: { data: big, baseline: await dataFp(null) } }));
    expect(failed(out).data.dataFailed.code).toBe('too-large');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses a save with no fingerprint baseline rather than guessing', async () => {
    const actions = await importActions();
    const out = await actions.updateData(actionEvent({ gid: 'mem-A', nodeId: 'pk', form: { data: '{"a":1}' } }));
    expect(failed(out).data.dataFailed.code).toBe('no-baseline');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses when the stored value changed since the editor opened — e.g. a Flow-tab edit — and writes NOTHING', async () => {
    mockRequest.mockResolvedValueOnce(dataNode({ data: { extractionSpec: { fields: [] } } }));
    const actions = await importActions();
    const out = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk', form: { data: '{"a":1}', baseline: await dataFp(null) },
    }));
    expect(failed(out).status).toBe(409);
    expect(failed(out).data.dataFailed.code).toBe('changed');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a no-op, but `{}` over no data IS a change', async () => {
    mockRequest.mockResolvedValueOnce(dataNode({ data: { b: 1, a: 2 } }));
    const actions = await importActions();
    expect(await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk', form: { data: '{"a":2,"b":1}', baseline: await dataFp({ b: 1, a: 2 }) },
    }))).toEqual({ dataSaved: true });
    expect(mockRequest).toHaveBeenCalledTimes(1);

    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce(dataNode({ data: null }));
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk' } });
    await actions.updateData(actionEvent({ gid: 'mem-A', nodeId: 'pk', form: { data: '{}', baseline: await dataFp(null) } }));
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('returns 404 when the node is not found', async () => {
    mockRequest.mockResolvedValueOnce({ node: null });
    const actions = await importActions();
    const out = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'missing', form: { data: '{"a":1}', baseline: await dataFp(null) },
    }));
    expect(failed(out).status).toBe(404);
    expect(failed(out).data.dataFailed.code).toBe('not-found');
  });

  it('a mutation failure is 500 with the server\'s words, not a stack of request JSON', async () => {
    mockRequest.mockResolvedValueOnce(dataNode());
    mockRequest.mockRejectedValueOnce(Object.assign(new Error('x'), {
      response: { errors: [{ message: 'Memory is locked', extensions: { code: 'SESSION_EXPIRED' } }] },
    }));
    const actions = await importActions();
    const out = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk', form: { data: '{"a":1}', baseline: await dataFp(null) },
    }));
    expect(failed(out).status).toBe(500);
    expect(failed(out).data.dataFailed).toEqual({ code: 'failed', detail: 'Memory is locked' });
  });

  it('an anonymous POST is refused before any API call', async () => {
    const actions = await importActions();
    const ev = actionEvent({ gid: 'mem-A', nodeId: 'pk', form: { data: '{}', baseline: await dataFp(null) } });
    (ev as unknown as { locals: { token: string | null } }).locals.token = null;
    const out = await actions.updateData(ev);
    expect(failed(out).status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses a stale save after another editor wrote `{}` over ABSENT data — null and {} are not one state here', async () => {
    // Both editors opened on no data; the other one saved {} first.
    mockRequest.mockResolvedValueOnce(dataNode({ data: {} }));
    const actions = await importActions();
    const out = await actions.updateData(actionEvent({
      gid: 'mem-A', nodeId: 'pk', form: { data: '[1]', baseline: await dataFp(null) },
    }));
    expect(failed(out).status).toBe(409);
    expect(failed(out).data.dataFailed.code).toBe('changed');
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

/**
 * An ancestor crumb shows the ancestor NODE'S NAME, not its loc segment.
 *
 * The crumb already renders a name for every other segment it can — the memory
 * ("Holger Personal Taxes", not `holger-personal-taxes`) and the leaf
 * (`node.name`). Ancestors were the only slugs, which made ONE node render
 * under two labels depending on where you stood: a parent titled
 * "Form: FBAR (FinCEN Form 114)" on its own page became `form-fbar` the moment
 * you clicked into a child.
 *
 * Pinned in both directions, because the fallback is load-bearing: a segment
 * with no node must KEEP its slug, and the "+ Create parent node" affordance
 * reads `seg.label` to seed the new node's name.
 */
describe('node-detail load — an ancestor crumb shows its name', () => {
  const MEM = 'mem-A';

  function nodeAt(loc: string, id: string) {
    return {
      id, memoryId: MEM, loc, name: 'FBAR — penalties and relief procedures',
      nodeType: 'reference', alias: null, description: null, content: null,
      tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
      isRunnable: null, createdAt: '', updatedAt: '',
      outgoingEdges: [], incomingEdges: [],
    };
  }

  it('uses the ancestor node’s name, and keeps its loc on the title', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeAt('form-fbar:penalties', 'penalties-pk') });

    const result = await runLoad(loadEvent({
      gid: MEM,
      nodeId: 'penalties-pk',
      parentGraphNodes: [
        { id: 'fbar-pk', memoryId: MEM, loc: 'form-fbar', name: 'Form: FBAR (FinCEN Form 114)' },
        { id: 'penalties-pk', memoryId: MEM, loc: 'form-fbar:penalties', name: 'FBAR — penalties and relief procedures' },
      ],
    }));

    const ancestor = result.breadcrumb.find((s) => s.path === 'form-fbar');
    expect(ancestor?.label).toBe('Form: FBAR (FinCEN Form 114)');
    expect(ancestor?.nodeId).toBe('fbar-pk');
    // @codex on #853: the address a reader copies must be the FULLY-QUALIFIED
    // node URN, not a bare loc — a bare loc does not say which memory it
    // belongs to once pasted into a CLI call or an MCP tool, which is the whole
    // reason this repo gates bare-loc citations.
    expect(ancestor?.title).toBe(
      'Form: FBAR (FinCEN Form 114) — hrn:node:acme.com:mem-a:form-fbar',
    );
  });

  it('keeps the SLUG for an ancestor that has no node', async () => {
    // The other direction, and it is not symmetry for its own sake: this is the
    // input the "+ Create parent node" form reads, and it seeds the new node's
    // name from `seg.label`. A name substituted here would have nothing behind
    // it, and the create form would propose it as fact.
    mockRequest.mockResolvedValueOnce({ node: nodeAt('form-fbar:penalties', 'penalties-pk') });

    const result = await runLoad(loadEvent({
      gid: MEM,
      nodeId: 'penalties-pk',
      parentGraphNodes: [
        { id: 'penalties-pk', memoryId: MEM, loc: 'form-fbar:penalties', name: 'FBAR — penalties' },
      ],
    }));

    const ancestor = result.breadcrumb.find((s) => s.path === 'form-fbar');
    expect(ancestor?.label).toBe('form-fbar');
    expect(ancestor?.nodeId).toBeNull();
    expect(ancestor?.title).toBeUndefined();
  });

  it('falls back to the slug when the ancestor node exists but is unnamed', async () => {
    // `name` is non-null in the slim projection's type, but an empty string is
    // not a usable label and would render a blank crumb with a live link.
    mockRequest.mockResolvedValueOnce({ node: nodeAt('form-fbar:penalties', 'penalties-pk') });

    const result = await runLoad(loadEvent({
      gid: MEM,
      nodeId: 'penalties-pk',
      parentGraphNodes: [
        { id: 'fbar-pk', memoryId: MEM, loc: 'form-fbar', name: '' },
        { id: 'penalties-pk', memoryId: MEM, loc: 'form-fbar:penalties', name: 'FBAR — penalties' },
      ],
    }));

    const ancestor = result.breadcrumb.find((s) => s.path === 'form-fbar');
    expect(ancestor?.label).toBe('form-fbar');
    // Still linked — the node exists, only its label is unusable.
    expect(ancestor?.nodeId).toBe('fbar-pk');
  });

  it('a foreign-memory ancestor lends neither its id NOR its name (#234)', async () => {
    // #234 scoped the ID lookup to this memory. The name comes off the same
    // map, so it inherits that scoping — asserted rather than assumed, because
    // a name borrowed from another memory's node would be a confident false
    // label on a crumb that correctly refuses to link.
    mockRequest.mockResolvedValueOnce({ node: nodeAt('form-fbar:penalties', 'penalties-pk') });

    const result = await runLoad(loadEvent({
      gid: MEM,
      nodeId: 'penalties-pk',
      parentGraphNodes: [
        { id: 'foreign-pk', memoryId: 'mem-B', loc: 'form-fbar', name: 'Someone else’s FBAR' },
        { id: 'penalties-pk', memoryId: MEM, loc: 'form-fbar:penalties', name: 'FBAR — penalties' },
      ],
    }));

    const ancestor = result.breadcrumb.find((s) => s.path === 'form-fbar');
    expect(ancestor?.label).toBe('form-fbar');
    expect(ancestor?.nodeId).toBeNull();
  });
});

/**
 * #853, @codex — an ancestor's hover text carries the FULLY-QUALIFIED node URN.
 *
 * Substituting the name for the slug removes the only place the ancestor's
 * address was visible, so the address has to go somewhere. A bare loc would not
 * do: it does not say which memory it belongs to once pasted into a CLI call,
 * an MCP tool or a message — the reason this repo gates bare-loc citations at
 * all.
 */
describe('node-detail load — an ancestor crumb carries a qualified URN', () => {
  const MEM = 'mem-A';

  function nodeAt(loc: string, id: string) {
    return {
      id, memoryId: MEM, loc, name: 'child',
      nodeType: 'reference', alias: null, description: null, content: null,
      tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
      isRunnable: null, createdAt: '', updatedAt: '',
      outgoingEdges: [], incomingEdges: [],
    };
  }

  const ancestors = [
    { id: 'fbar-pk', memoryId: MEM, loc: 'form-fbar', name: 'Form: FBAR' },
    { id: 'pen-pk', memoryId: MEM, loc: 'form-fbar:penalties', name: 'child' },
  ];

  it('qualifies the loc against the memory URN', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeAt('form-fbar:penalties', 'pen-pk') });
    const result = await runLoad(loadEvent({
      gid: MEM, nodeId: 'pen-pk', parentGraphNodes: ancestors,
      memoryUrn: 'hrn:mem:baragaun.com:holger-personal-taxes',
    }));
    expect(result.breadcrumb.find((s) => s.path === 'form-fbar')?.title).toBe(
      'Form: FBAR — hrn:node:baragaun.com:holger-personal-taxes:form-fbar',
    );
  });

  it('keeps the slug crumb, and the page loads, when the memory URN is unavailable', async () => {
    // The layout returns no `graph` when the memory read failed. portal#1433: an
    // ancestor is looked up by its node URN, so with no memory URN there is
    // nothing to look up. "Couldn't qualify it" must not take the page down or
    // render a broken crumb: each segment keeps its slug.
    mockRequest.mockResolvedValueOnce({ node: nodeAt('form-fbar:penalties', 'pen-pk') });
    const result = await runLoad(loadEvent({
      gid: MEM, nodeId: 'pen-pk', parentGraphNodes: ancestors, memoryUrn: null,
    }));
    const seg = result.breadcrumb.find((s) => s.path === 'form-fbar');
    expect(seg?.label).toBe('form-fbar');
    expect(seg?.nodeId).toBeNull();
  });

  it('keeps the slug crumb, and the page loads, when the memory URN is malformed', async () => {
    // composeNodeUrn throws on a wrong-type prefix. A throw here would take out
    // the whole node page over a breadcrumb.
    mockRequest.mockResolvedValueOnce({ node: nodeAt('form-fbar:penalties', 'pen-pk') });
    const result = await runLoad(loadEvent({
      gid: MEM, nodeId: 'pen-pk', parentGraphNodes: ancestors,
      memoryUrn: 'hrn:node:not-a-memory:at-all',
    }));
    const seg = result.breadcrumb.find((s) => s.path === 'form-fbar');
    expect(seg?.label).toBe('form-fbar');
    expect(seg?.nodeId).toBeNull();
  });
});

describe('node-detail load drains no graph (portal#1433)', () => {
  it('issues no memoryNodes or memoryEdges request, and returns children from the server read', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'n1', memoryId: 'mem-A', loc: 'specs:x', name: 'x', nodeType: 'info', alias: null,
        description: null, content: null, tokens: null, tags: [], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
      },
    });
    const result = (await runLoad(loadEvent({
      gid: 'mem-A', nodeId: 'n1',
      parentGraphNodes: [
        { id: 'c2', memoryId: 'mem-A', loc: 'specs:x:b', name: 'B' },
        { id: 'c1', memoryId: 'mem-A', loc: 'specs:x:a', name: 'A' },
        { id: 'g1', memoryId: 'mem-A', loc: 'specs:x:a:deep', name: 'Deep' },
      ],
    }))) as unknown as { children: Array<{ id: string }>; childrenUnavailable: boolean };
    // Children are the server's childrenOf read (portal#1656): direct only.
    expect(result.childrenUnavailable).toBe(false);
    expect(result.children.map((c) => c.id).sort()).toEqual(['c1', 'c2']);
    const docs = mockRequest.mock.calls.map(([d]) => d);
    expect(docs).not.toContain(MEMORY_NODES_QUERY);
    expect(docs).not.toContain(MEMORY_EDGES_QUERY);
  });
});
