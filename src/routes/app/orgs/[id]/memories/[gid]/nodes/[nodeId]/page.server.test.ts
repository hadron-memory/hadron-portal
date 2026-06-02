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
  gid: string;
  nodeId: string;
  parentGraphNodes: Array<{ id: string; memoryId: string; loc: string }>;
}) {
  return {
    params: { id: 'org-1', gid: opts.gid, nodeId: opts.nodeId },
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
      nodeById: {
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
      nodeById: {
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
      nodeById: {
        id: 'leaf-pk', memoryId: memA, loc: 'foo:bar:baz', name: 'baz',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });

    await runLoad(loadEvent({
      gid: memA,
      nodeId: 'leaf-pk',
      parentGraphNodes: [
        { id: 'foo-pk', memoryId: memA, loc: 'foo' },
        { id: 'foo-bar-pk', memoryId: memA, loc: 'foo:bar' },
        { id: 'leaf-pk', memoryId: memA, loc: 'foo:bar:baz' },
      ],
    }));

    // Only NODE_BY_ID_QUERY ran; the per-ancestor NODE_QUERY calls are gone.
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('#237 — redirects when node.memoryId does not match params.gid (PK-mismatch guard)', async () => {
    // The route is scoped by [gid] but nodeById resolves by PK alone.
    // A URL combining memory A's gid with memory B's nodeId was
    // silently rendering memory B's node under memory A's layout.
    // The guard redirects to the correct memory URL.
    mockRequest.mockResolvedValueOnce({
      nodeById: {
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
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-1/memories/mem-B/nodes/leaf-pk');
  });

  it('#237 — does NOT redirect when node.memoryId matches params.gid (happy path)', async () => {
    // Sanity check: the guard MUST be a no-op when the URL is
    // internally consistent. If this regresses, every node-detail
    // page load starts throwing 303s in a redirect loop.
    mockRequest.mockResolvedValueOnce({
      nodeById: {
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
 * Server-side root cause: `upsertNode` resolver at hadron-server
 * resolvers.ts:2678 defaults `serializeTags(input.tags ?? [])` — when the
 * portal omits `tags`, the server writes `[]`. Other "missing" fields are
 * safe because Prisma treats undefined as no-op, but tags has the
 * explicit empty-array default.
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
  gid: string;
  nodeId: string;
  form: Record<string, string>;
}) {
  const formData = new FormData();
  for (const [k, v] of Object.entries(opts.form)) formData.append(k, v);
  return {
    params: { id: 'org-1', gid: opts.gid, nodeId: opts.nodeId },
    locals: { token: 'tok' },
    request: { formData: async () => formData },
  } as unknown as Parameters<Actions[keyof Actions]>[0];
}

describe('node-detail actions — preserve tags on save (#235)', () => {
  it('updateContent: tags are explicitly passed through so the server doesn`t default-clear them', async () => {
    // NODE_BY_ID_QUERY load returns a node with tags. The action must
    // include those same tags in the UPSERT_NODE_MUTATION input.
    mockRequest.mockResolvedValueOnce({
      nodeById: {
        id: 'pk-1', memoryId: 'mem-A', loc: 'instructions', name: 'instructions',
        nodeType: 'info', alias: null, description: null, content: 'old content',
        tokens: null, tags: ['meta', 'onboarding'], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk-1' } });

    const actions = await importActions();
    await actions.updateContent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-1',
      form: { content: 'new content' },
    }));

    // Second call is the UPSERT_NODE_MUTATION. Its input must carry the
    // existing tags array verbatim.
    const upsertCall = mockRequest.mock.calls[1]!;
    const [, vars] = upsertCall as [unknown, { input: { tags?: unknown } }];
    expect(vars.input.tags).toEqual(['meta', 'onboarding']);
  });

  it('updateContent: coalesces a null `node.tags` to [] so a defensive runtime null can`t trigger the server`s ?? [] default', async () => {
    // TypeScript types `MemoryNode.tags` as `string[]` and the GraphQL
    // schema declares `tags: [String!]!`, but the portal-side `?? []`
    // is defensive insurance against a future schema regression or
    // deserializer bug. This test pins that defensive behavior — if
    // someone removes the `?? []` thinking it`s redundant, this fails.
    mockRequest.mockResolvedValueOnce({
      nodeById: {
        id: 'pk-null', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        // Cast: TS says non-null but we`re testing the belt-and-
        // suspenders coalesce against a runtime null.
        tokens: null, tags: null as unknown as string[], seq: null,
        data: null, ownerRepo: null, isRunnable: null, createdAt: '',
        updatedAt: '', outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk-null' } });

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
      nodeById: {
        id: 'pk-2', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk-2' } });

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
      nodeById: {
        id: 'pk-3', memoryId: 'mem-A', loc: 'src', name: 'src',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: ['kept'], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk-3' } });

    const actions = await importActions();
    await actions.updateEdges(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-3',
      form: { edges: JSON.stringify([{ targetId: 'pk-target', label: 'uses' }]) },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { tags?: unknown; edges?: unknown } }];
    expect(vars.input.tags).toEqual(['kept']);
    expect(vars.input.edges).toEqual([{ targetId: 'pk-target', label: 'uses' }]);
  });

  it("reorder: each per-loc upsert preserves the matching node's tags", async () => {
    // reorder iterates updates and upserts each one. Each upsert must
    // carry its own node's tags (NOT a shared blob, NOT empty).
    // First mocked call is the #237 anchor-node fetch; per-loc reads
    // start at index 1.
    mockRequest.mockResolvedValueOnce({
      nodeById: {
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
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk-a' } });
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-b', memoryId: 'mem-A', loc: 'b', name: 'b',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: ['b-tag1', 'b-tag2'], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk-b' } });

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
    // upsert 'a', [3] NODE_QUERY for 'b', [4] upsert 'b'.
    const [, varsA] = mockRequest.mock.calls[2]! as [unknown, { input: { tags?: unknown } }];
    const [, varsB] = mockRequest.mock.calls[4]! as [unknown, { input: { tags?: unknown } }];
    expect(varsA.input.tags).toEqual(['a-tag']);
    expect(varsB.input.tags).toEqual(['b-tag1', 'b-tag2']);
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
    // Stale URL says mem-A; node actually lives in mem-B. The upsert
    // input must carry mem-B, so the user's edit lands on the right row.
    mockRequest.mockResolvedValueOnce({
      nodeById: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, content: 'old',
        tokens: null, tags: ['x'], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk' } });

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

  it('delete: DELETE_NODE_MUTATION targets node.memoryId, and redirect URL points at it too', async () => {
    mockRequest.mockResolvedValueOnce({
      nodeById: {
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
    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { loc: string; memoryId: string }];
    expect(vars.memoryId).toBe('mem-B');
    // Redirect to mem-B's list, not mem-A's.
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-1/memories/mem-B/nodes');
  });

  it('createParent: upsert uses anchorNode.memoryId, not params.gid', async () => {
    // The form supplies a loc + name; the upsert's memoryId must match
    // the anchor node's actual memory (so a stale URL gid doesn't
    // create the new parent in the wrong memory).
    mockRequest.mockResolvedValueOnce({
      nodeById: {
        id: 'pk-anchor', memoryId: 'mem-B', loc: 'foo:bar', name: 'bar',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'new-parent-pk' } });

    const actions = await importActions();
    await actions.createParent(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-anchor',
      form: { loc: 'foo', name: 'foo' },
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { memoryId: string } }];
    expect(vars.input.memoryId).toBe('mem-B');
  });

  it('reorder: every per-loc upsert uses anchorNode.memoryId, not params.gid', async () => {
    // Anchor fetch up front, then a NODE_QUERY + UPSERT per loc.
    mockRequest.mockResolvedValueOnce({
      nodeById: {
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
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk-a' } });

    const actions = await importActions();
    await actions.reorder(actionEvent({
      gid: 'mem-A',
      nodeId: 'pk-anchor',
      form: { updates: JSON.stringify([{ loc: 'foo:a', seq: 1 }]) },
    }));

    // Calls: [0] anchor fetch, [1] NODE_QUERY for loc 'foo:a', [2] upsert.
    const [, vars] = mockRequest.mock.calls[2]! as [unknown, { input: { memoryId: string } }];
    expect(vars.input.memoryId).toBe('mem-B');
  });
});

/**
 * #257 slice 1 — updateAbstract inline save. The abstract is the default
 * vector-index source (spec 031/033), edited inline on the detail page just
 * like content. The action must (a) send the abstract through upsertNode,
 * (b) preserve tags (#235 guard), and (c) derive memoryId from the fetched
 * node (#237 guard). The raw string is sent verbatim — the server
 * normalizes empty/whitespace-only to null and caps length.
 */
describe('node-detail action — updateAbstract (#257)', () => {
  it('sends the abstract through upsertNode while preserving tags and node.memoryId', async () => {
    // Stale URL says mem-A; the node lives in mem-B and carries tags.
    mockRequest.mockResolvedValueOnce({
      nodeById: {
        id: 'pk', memoryId: 'mem-B', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, abstract: 'old summary',
        content: 'body', tokens: null, tags: ['kept'], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk' } });

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
      nodeById: {
        id: 'pk', memoryId: 'mem-A', loc: 'a', name: 'a',
        nodeType: 'info', alias: null, description: null, abstract: 'something',
        content: null, tokens: null, tags: [], seq: null, data: null,
        ownerRepo: null, isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk' } });

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
