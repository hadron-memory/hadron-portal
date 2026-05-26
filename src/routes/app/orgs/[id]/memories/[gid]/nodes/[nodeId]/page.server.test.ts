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

    const load = await importLoad();
    const result = await load(loadEvent({
      gid: memA,
      nodeId: 'A-chats-setup-pk',
      // Parent layout already filters to memA — but defensively the loader
      // also filters by memoryId in case the contract changes.
      parentGraphNodes: [
        { id: 'A-chats-pk', memoryId: memA, loc: 'chats' },
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

    const load = await importLoad();
    const result = await load(loadEvent({
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

    const load = await importLoad();
    await load(loadEvent({
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
});
