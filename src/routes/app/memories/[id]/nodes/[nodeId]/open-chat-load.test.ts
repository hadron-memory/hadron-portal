import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { serveMemoryReads, type SeedNode } from '$lib/test/serveMemoryReads';

// portal#1433: the node reads that replaced the layout's graphNodes.
let reads = serveMemoryReads([], { id: 'mem-1', urn: 'hrn:mem:acme.com:notes' });
const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const MEM = 'mem-1';
const CHAT_LOC = 'chats:team';
const MSG_LOC = `${CHAT_LOC}:messages:001-ada`;

beforeEach(() => {
  mockRequest.mockReset();
});

function nodeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'msg-pk',
    memoryId: MEM,
    memory: { id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'notes', appId: 'app-1' },
    loc: MSG_LOC,
    name: '001-ada',
    nodeType: 'chat-message',
    alias: null, description: null, content: null, abstract: null,
    data: null, properties: null, tags: [], seq: 1, isRunnable: null,
    createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
    ...over,
  };
}

/** A seeded node the server's `nodeBatch` answers with (it used to ride in the layout's `graphNodes`). */
function graphRow(over: Record<string, unknown> = {}) {
  return {
    id: 'chat-pk', memoryId: MEM, loc: CHAT_LOC, name: 'team',
    nodeType: 'chat', tags: [], seq: null, isRunnable: null, description: null,
    ...over,
  };
}

async function runLoad(over: { node?: Record<string, unknown>; graphNodes?: unknown[] } = {}) {
  reads = serveMemoryReads((over.graphNodes ?? [graphRow()]) as SeedNode[], { id: MEM, urn: 'hrn:mem:acme.com:notes' });
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    { const served = reads(doc, vars); if (served !== undefined) return served; }
    if (doc === NODE_BY_ID_QUERY) return { node: over.node ?? nodeRow() };
    return { memories: { items: [], total: 0 } };
  });

  const { load } = await import('./+page.server');
  const event = {
    params: { id: MEM, nodeId: 'msg-pk' },
    locals: { token: 'tok' },
    url: new URL(`http://localhost/app/memories/${MEM}/nodes/msg-pk`),
    parent: vi.fn().mockResolvedValue({
      graph: { id: MEM, urn: 'hrn:mem:acme.com:notes', appId: 'app-1' },
      isConsumerMode: false, activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<typeof load>[0];

  return (await load(event)) as unknown as {
    isChat: boolean;
    isChatMessage: boolean;
    openChat: { nodeId: string; loc: string; name: string } | null;
  };
}

// #725/#726. `openChat` is BOTH the gate for the "Open chat" menu item and its
// destination, so every case here is either an offer the page will make or one
// it will withhold — there is no third state where the item shows and the link
// is wrong.
describe('node-detail load — Open chat (#726)', () => {
  it('resolves the chat root for a platform chat-message', async () => {
    const data = await runLoad();
    expect(data.isChatMessage).toBe(true);
    expect(data.isChat).toBe(false);
    expect(data.openChat).toEqual({ nodeId: 'chat-pk', loc: CHAT_LOC, name: 'team' });
  });

  it('resolves it WITHOUT a further round trip', async () => {
    // The whole design: the chat root comes out of the layout payload the
    // breadcrumb already walks. If this ever starts costing a fetch, every
    // message page pays it.
    await runLoad();
    const docs = mockRequest.mock.calls.map((c) => c[0]);
    expect(docs.filter((d) => d === NODE_BY_ID_QUERY)).toHaveLength(1);
  });

  it('withholds the action when the ancestor is not a chat node', async () => {
    // A `<x>:messages:<y>` address does not make `<x>` a chat. Offering "Open
    // chat" here would be a link that lies about where it goes.
    const data = await runLoad({ graphNodes: [graphRow({ nodeType: 'info', tags: [] })] });
    expect(data.isChatMessage).toBe(true);
    expect(data.openChat).toBeNull();
  });

  it('withholds it when the matching loc belongs to a DIFFERENT memory', async () => {
    // A loc is unique per memory, not globally (#234). Without the scope check
    // this would link to a foreign memory's node under this memory's basePath.
    const data = await runLoad({ graphNodes: [graphRow({ memoryId: 'mem-2', id: 'other-pk' })] });
    expect(data.openChat).toBeNull();
  });

  it('withholds it when the graph payload is unavailable, and still MARKS the message', async () => {
    // A failed graph read yields the same empty list as an empty memory. The
    // action is withheld rather than pointed somewhere, but `isChatMessage` is
    // derived from the node itself and is unaffected — so the header still
    // says what this node is.
    const data = await runLoad({ graphNodes: [] });
    expect(data.isChatMessage).toBe(true);
    expect(data.openChat).toBeNull();
  });

  it('accepts a legacy `message` under a legacy `team-chat` root', async () => {
    const data = await runLoad({
      node: nodeRow({ nodeType: 'message' }),
      graphNodes: [graphRow({ nodeType: 'info', tags: ['team-chat'] })],
    });
    expect(data.isChatMessage).toBe(true);
    expect(data.openChat).toEqual({ nodeId: 'chat-pk', loc: CHAT_LOC, name: 'team' });
  });

  it('offers nothing on the chat ROOT itself', async () => {
    const data = await runLoad({
      node: nodeRow({ id: 'chat-pk', loc: CHAT_LOC, nodeType: 'chat', name: 'team' }),
    });
    expect(data.isChat).toBe(true);
    expect(data.isChatMessage).toBe(false);
    expect(data.openChat).toBeNull();
  });

  it('offers nothing on an ordinary node', async () => {
    const data = await runLoad({ node: nodeRow({ loc: 'notes:one', nodeType: 'info', seq: null }) });
    expect(data.isChatMessage).toBe(false);
    expect(data.openChat).toBeNull();
  });

  it('falls back to the loc when the chat root has no name', async () => {
    const data = await runLoad({ graphNodes: [graphRow({ name: null })] });
    expect(data.openChat?.name).toBe(CHAT_LOC);
  });
});
