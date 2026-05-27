/**
 * #235 regression test — the api/nodes/reorder endpoint must preserve the
 * affected nodes' tags through the per-loc upsert loop. The upsertNode
 * resolver in hadron-server defaults `input.tags ?? []`, so omitting tags
 * clears them. This endpoint is the JSON sibling of the form-action
 * `reorder` in /memories/[gid]/nodes/[nodeId]/+page.server.ts; both
 * carry the same fix and the same pin.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importPOST() {
  const mod = await import('./+server');
  return mod.POST;
}

function postEvent(body: unknown, opts: { authed?: boolean } = { authed: true }) {
  return {
    locals: { token: opts.authed === false ? null : 'tok' },
    request: { json: async () => body },
  } as unknown as Parameters<Awaited<ReturnType<typeof importPOST>>>[0];
}

describe('POST /api/nodes/reorder — preserve tags per upsert (#235)', () => {
  it('carries each node`s tags into the matching UPSERT_NODE_MUTATION input', async () => {
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

    const POST = await importPOST();
    await POST(postEvent({
      memoryId: 'mem-A',
      updates: [
        { loc: 'a', seq: 1 },
        { loc: 'b', seq: 2 },
      ],
    }));

    // Calls 0 + 2 are NODE_QUERY reads; calls 1 + 3 are the upserts.
    const [, varsA] = mockRequest.mock.calls[1]! as [unknown, { input: { tags?: unknown } }];
    const [, varsB] = mockRequest.mock.calls[3]! as [unknown, { input: { tags?: unknown } }];
    expect(varsA.input.tags).toEqual(['a-tag']);
    expect(varsB.input.tags).toEqual(['b-tag1', 'b-tag2']);
  });

  it('preserves empty tags ([]) explicitly so a future refactor can`t silently drop the pass-through', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'pk-x', memoryId: 'mem-A', loc: 'x', name: 'x',
        nodeType: 'info', alias: null, description: null, content: null,
        tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
        isRunnable: null, createdAt: '', updatedAt: '',
        outgoingEdges: [], incomingEdges: [],
      },
    });
    mockRequest.mockResolvedValueOnce({ upsertNode: { id: 'pk-x' } });

    const POST = await importPOST();
    await POST(postEvent({
      memoryId: 'mem-A',
      updates: [{ loc: 'x', seq: 1 }],
    }));

    const [, vars] = mockRequest.mock.calls[1]! as [unknown, { input: { tags?: unknown } }];
    expect(vars.input.tags).toEqual([]);
  });

  it('returns 401 when no token is present', async () => {
    const POST = await importPOST();
    const res = await POST(postEvent({ memoryId: 'm', updates: [] }, { authed: false }));
    expect(res.status).toBe(401);
  });
});
