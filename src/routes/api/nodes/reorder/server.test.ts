/**
 * #235 regression test — the api/nodes/reorder endpoint must preserve the
 * affected nodes' tags through the per-loc update loop. (Historically the
 * upsertNode resolver defaulted `input.tags ?? []`, so omitting tags cleared
 * them; its updateNode replacement (hadron-server#460) preserves omitted
 * tags, but the explicit pass-through is still the correct round-trip and
 * stays pinned.) This endpoint is the JSON sibling of the form-action
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

/** A node row shaped like NODE_FIELDS, with only the parts these tests vary. */
function nodeRow(over: Record<string, unknown>) {
  return {
    id: 'pk', memoryId: 'mem-A', loc: 'x', name: 'x',
    nodeType: 'info', alias: null, description: null, content: null,
    tokens: null, tags: [], seq: null, data: null, ownerRepo: null,
    isRunnable: null, role: null, createdAt: '', updatedAt: '',
    outgoingEdges: [], incomingEdges: [], ...over,
  };
}

/**
 * Answer each NODE_QUERY by loc and record the writes.
 *
 * Deliberately NOT a `mockResolvedValueOnce` chain. That encoded the CALL
 * ORDER — read, write, read, write — and #868/#869 split the loop into two
 * passes (resolve every door, then write), so the reads now all precede the
 * writes. A sequencing mock fails that as though the tags pass-through broke,
 * which is not what these tests are about; dispatching on the query says what
 * the fixture means instead of when it is consumed.
 */
function serveNodes(byLoc: Record<string, Record<string, unknown>>) {
  mockRequest.mockImplementation(async (_query: unknown, vars: { ref?: string }) => {
    const row = vars?.ref === undefined ? undefined : byLoc[vars.ref];
    return row ? { node: row } : { updateNode: { id: 'pk' } };
  });
}

/** Every write call's input, in order — the reads are the ones carrying `ref`. */
function writeInputs() {
  return mockRequest.mock.calls
    .filter(([, vars]) => (vars as { ref?: string } | undefined)?.ref === undefined)
    .map(([, vars]) => (vars as { input: { tags?: unknown } }).input);
}

describe('POST /api/nodes/reorder — preserve tags per update (#235)', () => {
  it('carries each node`s tags into the matching UPDATE_NODE_MUTATION input', async () => {
    serveNodes({
      a: nodeRow({ id: 'pk-a', loc: 'a', name: 'a', tags: ['a-tag'] }),
      b: nodeRow({ id: 'pk-b', loc: 'b', name: 'b', tags: ['b-tag1', 'b-tag2'] }),
    });

    const POST = await importPOST();
    await POST(postEvent({
      memoryId: 'mem-A',
      updates: [
        { loc: 'a', seq: 1 },
        { loc: 'b', seq: 2 },
      ],
    }));

    const [inputA, inputB] = writeInputs();
    expect(inputA.tags).toEqual(['a-tag']);
    expect(inputB.tags).toEqual(['b-tag1', 'b-tag2']);
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
    mockRequest.mockResolvedValueOnce({ updateNode: { id: 'pk-x' } });

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
