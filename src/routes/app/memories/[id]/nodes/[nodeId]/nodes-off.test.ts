/**
 * portal#1524 (Holger, 2026-10-31): the memory layout no longer loads the node
 * list (`nodesOff: true`, no `graphNodes`). This pins, one case per consumer row
 * of the issue's table that lives in the node-page LOADER, what the page says
 * and does not say when it has no list to read:
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
import { NODE_BY_ID_QUERY, NODE_CHILDREN_QUERY } from '$lib/server/queries';

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

type Child = { id: string; loc: string; name: string; seq: number | null; commentSummary?: { openThreads: number } | null };
const child = (loc: string, seq: number | null = null, threads = 0): { node: Child } => ({
  node: { id: `id-${loc}`, loc, name: loc, seq, commentSummary: { openThreads: threads } },
});

async function runLoad(opts: {
  node?: Record<string, unknown>;
  hits?: Array<{ node: Child }>;
  total?: number;
  childrenThrow?: boolean;
} = {}) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY) return { node: opts.node ?? nodeRow() };
    if (doc === NODE_CHILDREN_QUERY) {
      if (opts.childrenThrow) throw new Error('boom');
      const hits = opts.hits ?? [];
      return { findNodes: { total: opts.total ?? hits.length, hits } };
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
    childrenUnavailable: boolean;
  };
}

describe('node-detail load with the node list off (portal#1524)', () => {
  it('breadcrumb: ancestors fall back to their loc segments, with no node id', async () => {
    const data = await runLoad();
    expect(data.breadcrumb.map((s) => [s.label, s.nodeId])).toEqual([['a', null], ['b', null], ['leaf', null]]);
  });

  it('breadcrumb: never offers to CREATE an ancestor it did not look up', async () => {
    // "No node id" here means "not looked up". Offering "+ Create parent node"
    // for every ancestor would claim none of them exist.
    const data = await runLoad();
    expect(data.ancestorsKnown).toBe(false);
  });

  it('chat root: "Open chat" is withheld for a chat message', async () => {
    const data = await runLoad({ node: nodeRow({ loc: 'chats:team:messages:001-ada', nodeType: 'chat-message' }) });
    expect(data.openChat).toBeNull();
  });

  it('wikilinks: a same-memory link is clickable but UNCHECKED, never a missing-node marker', async () => {
    const data = await runLoad({ node: nodeRow({ content: 'see [[other:thing]]' }) });
    const link = data.wikilinks['other:thing'];
    expect(link).not.toBeNull(); // null is the "broken link" marker
    expect(link!.href).toBe(`/app/u/${'hrn:node:acme.com:notes:other:thing'}`);
  });

  it('children: ONE bounded read, scoped to this memory and this loc', async () => {
    await runLoad({ hits: [child('a:b:leaf:x')] });
    const calls = mockRequest.mock.calls.filter(([d]) => d === NODE_CHILDREN_QUERY);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ memoryId: MEM, locPrefix: 'a:b:leaf:', limit: 200 });
  });

  it('children: only DIRECT children, with the open-thread count carried through', async () => {
    const data = await runLoad({ hits: [child('a:b:leaf:x', 1, 2), child('a:b:leaf:x:deep'), child('a:b:leaf:y', 2)] });
    expect(data.childrenUnavailable).toBe(false);
    expect(data.children!.map((c) => [c.loc, c.openThreads])).toEqual([['a:b:leaf:x', 2], ['a:b:leaf:y', 0]]);
  });

  it('children: a leaf with a complete empty read is genuinely childless', async () => {
    const data = await runLoad({ hits: [], total: 0 });
    expect(data.children).toEqual([]);
    expect(data.childrenUnavailable).toBe(false);
  });

  it('children: a page that is not the whole subtree is UNAVAILABLE, not a short list', async () => {
    // 200 returned of 450: which direct children exist cannot be told.
    const data = await runLoad({ hits: Array.from({ length: 200 }, (_, i) => child(`a:b:leaf:c${i}:d`)), total: 450 });
    expect(data.children).toBeNull();
    expect(data.childrenUnavailable).toBe(true);
  });

  it('children: a failed read is UNAVAILABLE, not "no children"', async () => {
    const data = await runLoad({ childrenThrow: true });
    expect(data.children).toBeNull();
    expect(data.childrenUnavailable).toBe(true);
  });
});
