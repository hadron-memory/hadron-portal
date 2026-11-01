import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { serveMemoryReads } from '$lib/test/serveMemoryReads';

// portal#1433: the node reads that replaced the layout's graphNodes.
let reads = serveMemoryReads([], { id: 'mem-1', urn: 'hrn:mem:acme.com:notes' });
const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const MEM = 'mem-1';
const CHAT_LOC = 'chats:team';
const APP = { id: 'app-1', urn: 'hrn:app:acme.com:workstation', name: 'Workstation' };

beforeEach(() => {
  mockRequest.mockReset();
});

/** A chat ROOT row, as NODE_BY_ID_QUERY returns it (with the detail-only `app`). */
function chatRow(over: Record<string, unknown> = {}, memoryOver: Record<string, unknown> = {}) {
  return {
    id: 'chat-pk',
    memoryId: MEM,
    memory: {
      id: MEM, urn: 'hrn:mem:acme.com:notes', name: 'notes',
      appId: APP.id, app: APP,
      ...memoryOver,
    },
    loc: CHAT_LOC,
    name: 'Team chat',
    nodeType: 'chat',
    alias: null, description: 'Team chat — Workstation', content: null, abstract: null,
    data: null, properties: null, tags: [], seq: null, isRunnable: null,
    createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
    ...over,
  };
}

async function runLoad(node: Record<string, unknown>) {
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    { const served = reads(doc, vars); if (served !== undefined) return served; }
    if (doc === NODE_BY_ID_QUERY) return { node };
    return { memories: { items: [], total: 0 }, nodes: { items: [], total: 0 } };
  });

  const { load } = await import('./+page.server');
  const event = {
    params: { id: MEM, nodeId: 'chat-pk' },
    locals: { token: 'tok' },
    url: new URL(`http://localhost/app/memories/${MEM}/nodes/chat-pk`),
    parent: vi.fn().mockResolvedValue({
      graphNodes: [],
      graph: { id: MEM, urn: 'hrn:mem:acme.com:notes', appId: APP.id },
      isConsumerMode: false, activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<typeof load>[0];

  return (await load(event)) as unknown as {
    isChat: boolean;
    chatApp: { id: string; urn: string; name: string } | null;
  };
}

// #489 part 4. Before this, the App was visible on a chat page ONLY because the
// server writes "Team chat — <App>" into the node's `description`, which the
// header renders verbatim. That is prose, not a reference: it would vanish if
// anyone edited the string, it is not a link, and it carries no URN to paste.
//
// These cases pin the three states a reader can be in, because the failure that
// matters is not a crash — it is an App chip that renders empty, or one that
// appears on a page whose App it does not actually describe.
describe('node-detail load — the chat App reference (#489 part 4)', () => {
  it('exposes the App for a chat node in an App memory', async () => {
    const data = await runLoad(chatRow());
    expect(data.isChat).toBe(true);
    expect(data.chatApp).toEqual(APP);
  });

  it('is null for a chat with NO App — absent, never an empty chip', async () => {
    // A chat outside an App is legitimate and readable (the page says so in its
    // own empty state). CLAUDE.md: a nullable-by-contract URN renders as absent
    // rather than as an empty chip, so the loader must hand the page `null`
    // rather than a half-populated object.
    const data = await runLoad(chatRow({}, { appId: null, app: null }));
    expect(data.isChat).toBe(true);
    expect(data.chatApp).toBeNull();
  });

  it('normalises an UNSELECTED app to null, not undefined', async () => {
    // `app` is detail-only, so a node row that came from a search or list
    // payload has no `app` key at all — which is a different fact from
    // `app: null` ("asked, there is no App"). The page renders on truthiness so
    // both behave the same there, but `chatApp` is part of the load's contract
    // and `undefined` would serialise away rather than travel as an explicit
    // "none".
    //
    // This case exists because the `?? null` it pins survived a mutation that
    // the `app: null` case above did NOT catch — that one never reaches the
    // coalesce (`hrn:node:hadronmemory.com:hadron-portal:review:a-spare-test-must-reach-the-matcher`).
    const row = chatRow();
    delete (row.memory as Record<string, unknown>).app;
    const data = await runLoad(row);
    expect(data.isChat).toBe(true);
    expect(data.chatApp).toBeNull();
    expect(data.chatApp).not.toBeUndefined();
  });

  it('is null for an ORDINARY node, even in an App memory', async () => {
    // The reference exists because a chat page NAMES its App. An ordinary node
    // does not, and `hrn:node:hadronmemory.com:hadron-portal:review:render-urn` is about rendering the URN of an entity
    // a view already refers to — not about surfacing every ancestor. Without
    // this the chip would appear on every node in an App memory.
    const data = await runLoad(chatRow({ nodeType: 'info', loc: 'notes:thing', tags: [] }));
    expect(data.isChat).toBe(false);
    expect(data.chatApp).toBeNull();
  });

  it('costs no extra round trip — the App rides on the node read', async () => {
    // `app` is merged onto `memory` inside NODE_BY_ID_QUERY rather than fetched
    // separately, so this must stay a single document. If it ever starts
    // costing a second request, every chat page pays it.
    await runLoad(chatRow());
    const docs = mockRequest.mock.calls.map((c) => c[0]);
    expect(docs.filter((d) => d === NODE_BY_ID_QUERY)).toHaveLength(1);
  });
});
