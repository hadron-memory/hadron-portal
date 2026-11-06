/**
 * portal#1524 (Holger, 2026-10-31): the memory layout no longer loads the node
 * list (`nodesOff: true`, no `graphNodes`). This pins, one case per consumer row
 * of the issue's table that lives in the node-page LOADER, what the page says
 * and does not say when it has no list to read.
 *
 * portal#1433 repaired the breadcrumb, chat root and wikilinks with bounded
 * reads; their equality with the old path is pinned in oracle-pre-1527.test.ts.
 * What stays pinned HERE is acceptance 4: when those reads FAIL, the page
 * degrades exactly as the #1524 path did:
 *
 *   - the breadcrumb falls back to loc segments and never offers to create an
 *     ancestor it did not look up;
 *   - "Open chat" is withheld (an affordance, not an assertion);
 *   - a wikilink renders unresolved-but-clickable, never as a missing node;
 *   - Children come from ONE bounded read, and a read that cannot be proven
 *     complete says "unavailable", never "no children".
 *
 * The absent list is never read as "this memory has no nodes".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_ANCESTORS_QUERY, NODE_BY_ID_QUERY, NODE_CHILDREN_QUERY, WIKILINK_TARGETS_BATCH_QUERY } from '$lib/server/queries';
import { fakeFindNodesChildren, type FakeChildRow } from '$lib/test/fakeFindNodesChildren';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const MEM = 'mem-1';
const MEM_URN = 'hrn:mem:acme.com:notes';

beforeEach(() => {
  mockRequest.mockReset();
});

function nodeRow(over: Record<string, unknown> = {}) {
  return {
    id: 'leaf-pk', memoryId: MEM, memory: { id: MEM, urn: MEM_URN, name: 'notes', appId: null },
    loc: 'a:b:leaf', name: 'leaf', nodeType: 'info',
    alias: null, description: null, content: null, abstract: null,
    data: null, properties: null, tags: [], seq: 1, isRunnable: null,
    createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
    ...over,
  };
}

async function runLoad(opts: {
  node?: Record<string, unknown>;
  /** The memory's nodes, answered as the server answers a loc-scoped findNodes. */
  tree?: FakeChildRow[];
  childrenThrow?: boolean;
  /** The portal#1433 bounded reads (ancestors, wikilink targets) fail. */
  boundedReadsThrow?: boolean;
} = {}) {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    if (doc === NODE_BY_ID_QUERY) return { node: opts.node ?? nodeRow() };
    if (doc === NODE_ANCESTORS_QUERY || doc === WIKILINK_TARGETS_BATCH_QUERY) {
      if (opts.boundedReadsThrow) throw new Error('boom');
      return { nodeBatch: { nodes: [], unavailable: [], omitted: [], truncated: false } };
    }
    if (doc === NODE_CHILDREN_QUERY) {
      if (opts.childrenThrow) throw new Error('boom');
      return fakeFindNodesChildren(opts.tree ?? [], MEM)(vars);
    }
    return { memories: { items: [], total: 0 } };
  });
  const { load } = await import('./+page.server');
  const event = {
    params: { id: MEM, nodeId: 'leaf-pk' },
    locals: { token: 'tok' },
    url: new URL(`http://localhost/app/memories/${MEM}/nodes/leaf-pk`),
    // The real layout under nodesOff: NO graphNodes key at all.
    parent: vi.fn().mockResolvedValue({
      graph: { id: MEM, urn: MEM_URN }, nodesOff: true, nodesFailed: false, nodesTotal: null,
      isConsumerMode: false, activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<typeof load>[0];
  return (await load(event)) as unknown as {
    breadcrumb: Array<{ label: string; path: string; nodeId: string | null }>;
    ancestorsKnown: boolean;
    openChat: unknown;
    wikilinks: Record<string, { href: string; label: string } | null>;
    children: Array<{ loc: string; openThreads: number }> | null;
    childrenHasMore: boolean;
    childrenUnavailable: boolean;
  };
}

describe('node-detail load with the node list off (portal#1524)', () => {
  it('breadcrumb: ancestors fall back to their loc segments, with no node id', async () => {
    const data = await runLoad({ boundedReadsThrow: true });
    expect(data.breadcrumb.map((s) => [s.label, s.nodeId])).toEqual([['a', null], ['b', null], ['leaf', null]]);
  });

  it('breadcrumb: never offers to CREATE an ancestor it did not look up', async () => {
    // "No node id" here means "not looked up". Offering "+ Create parent node"
    // for every ancestor would claim none of them exist.
    const data = await runLoad({ boundedReadsThrow: true });
    expect(data.ancestorsKnown).toBe(false);
  });

  it('breadcrumb: a read that ANSWERED without an ancestor may offer to create it', async () => {
    const data = await runLoad();
    expect(data.breadcrumb.map((s) => [s.label, s.nodeId])).toEqual([['a', null], ['b', null], ['leaf', null]]);
    expect(data.ancestorsKnown).toBe(true);
  });

  it('chat root: "Open chat" is withheld for a chat message', async () => {
    const data = await runLoad({ node: nodeRow({ loc: 'chats:team:messages:001-ada', nodeType: 'chat-message' }), boundedReadsThrow: true });
    expect(data.openChat).toBeNull();
  });

  it('wikilinks: a same-memory link is clickable but UNCHECKED, never a missing-node marker', async () => {
    const data = await runLoad({ node: nodeRow({ content: 'see [[other:thing]]' }), boundedReadsThrow: true });
    const link = data.wikilinks['other:thing'];
    expect(link).not.toBeNull(); // null is the "broken link" marker
    expect(link!.href).toBe(`/app/u/${'hrn:node:acme.com:notes:other:thing'}`);
  });

  // portal#1656: the section reads with `childrenOf` (hadron-server#2832), a
  // page of 20 asked as 21 so a 21st row says more exist (the server sends no
  // signal: `total` is null on this filter), and no sort, so the order shown is
  // the server's sibling order.
  const under = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${from + i}`, loc: `a:b:leaf:c${String(from + i).padStart(3, '0')}` }));

  it('children: ONE childrenOf read of 21, scoped to this memory and loc, with no locPrefix and no sort', async () => {
    await runLoad({ tree: under(3) });
    const calls = mockRequest.mock.calls.filter(([d]) => d === NODE_CHILDREN_QUERY);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ memoryId: MEM, childrenOf: 'a:b:leaf', limit: 21, offset: 0 });
    expect(NODE_CHILDREN_QUERY).toContain('childrenOf: $childrenOf');
    expect(NODE_CHILDREN_QUERY).not.toMatch(/locPrefix|sort:/);
  });

  it('children: a parent with more than 200 descendants and 3 direct children shows exactly the 3', async () => {
    const deep = Array.from({ length: 250 }, (_, i) => ({ id: `d${i}`, loc: `a:b:leaf:x:d${i}` }));
    const data = await runLoad({ tree: [...deep, { id: 'x', loc: 'a:b:leaf:x' }, { id: 'y', loc: 'a:b:leaf:y' }, { id: 'z', loc: 'a:b:leaf:z' }] });
    expect(data.childrenUnavailable).toBe(false);
    expect(data.childrenHasMore).toBe(false);
    expect(data.children!.map((c) => c.loc)).toEqual(['a:b:leaf:x', 'a:b:leaf:y', 'a:b:leaf:z']);
  });

  it('children: the root lists the top-level nodes only', async () => {
    const data = await runLoad({ node: nodeRow({ loc: '' }), tree: [{ id: 't1', loc: 'top' }, { id: 't2', loc: 'top:kid' }, { id: 't3', loc: 'other' }] });
    expect(mockRequest.mock.calls.find(([d]) => d === NODE_CHILDREN_QUERY)![1]).toMatchObject({ childrenOf: '' });
    expect(data.children!.map((c) => c.loc)).toEqual(['other', 'top']);
  });

  it('children: exactly 20 direct children show 20 and no "more" (asked 21, got 20)', async () => {
    const data = await runLoad({ tree: under(20) });
    expect(data.children).toHaveLength(20);
    expect(data.childrenHasMore).toBe(false);
  });

  it('children: 21 direct children show 20 and say more exist', async () => {
    const data = await runLoad({ tree: under(21) });
    expect(data.children!.map((c) => c.loc)).toEqual(under(20).map((c) => c.loc));
    expect(data.childrenHasMore).toBe(true);
    expect(data.childrenUnavailable).toBe(false);
  });

  it("children: shown in the server's sibling order, positioned first then by loc, never re-sorted", async () => {
    const data = await runLoad({ tree: [
      { id: 'u-b', loc: 'a:b:leaf:b' }, { id: 'p2', loc: 'a:b:leaf:z', seq: 2 },
      { id: 'u-a', loc: 'a:b:leaf:a' }, { id: 'p1', loc: 'a:b:leaf:y', seq: 1 },
    ] });
    expect(data.children!.map((c) => c.loc)).toEqual(['a:b:leaf:y', 'a:b:leaf:z', 'a:b:leaf:a', 'a:b:leaf:b']);
  });

  it('children: the open-thread count is carried through', async () => {
    const tree = [{ id: 'id-a:b:leaf:x', loc: 'a:b:leaf:x', commentSummary: { openThreads: 2 } }];
    mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
      if (doc === NODE_BY_ID_QUERY) return { node: nodeRow() };
      if (doc === NODE_CHILDREN_QUERY) return fakeFindNodesChildren(tree, MEM)(vars);
      return { nodeBatch: { nodes: [], unavailable: [], omitted: [], truncated: false } };
    });
    const { load } = await import('./+page.server');
    const data = (await load({
      params: { id: MEM, nodeId: 'leaf-pk' }, locals: { token: 'tok' },
      url: new URL(`http://localhost/app/memories/${MEM}/nodes/leaf-pk`),
      parent: vi.fn().mockResolvedValue({ graph: { id: MEM, urn: MEM_URN }, nodesOff: true, isConsumerMode: false, activeOrgId: 'org-1' }),
    } as never)) as unknown as { children: Array<{ loc: string; openThreads: number }> };
    expect(data.children.map((c) => [c.loc, c.openThreads])).toEqual([['a:b:leaf:x', 2]]);
  });

  it('children: a leaf with no children is genuinely childless', async () => {
    const data = await runLoad({ tree: [] });
    expect(data.children).toEqual([]);
    expect(data.childrenHasMore).toBe(false);
    expect(data.childrenUnavailable).toBe(false);
  });

  it('children: a failed read is UNAVAILABLE, not "no children"', async () => {
    const data = await runLoad({ childrenThrow: true });
    expect(data.children).toBeNull();
    expect(data.childrenHasMore).toBe(false);
    expect(data.childrenUnavailable).toBe(true);
  });
});
