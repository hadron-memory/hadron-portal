/**
 * portal#1433 acceptance 2: on a seeded memory, the node page's breadcrumb
 * links, wikilink resolution and chat-root detection equal the pre-#1527
 * in-memory code path at 3b333cf0^ run on the same fixture.
 *
 * The NEW side is the real `load()` with the layout as main ships it now
 * (`nodesOff: true`, no `graphNodes`), its bounded reads answered from the
 * seeded rows. The OLD side is the code at 3b333cf0^ (`$lib/test/oracle`)
 * given the same rows as the layout's `graphNodes`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serveMemoryReads, type SeedNode } from '$lib/test/serveMemoryReads';
import { oldBreadcrumb, oldOpenChat } from '$lib/test/oracle/node-page-pre-1527';
import { resolveWikilinks as oldResolveWikilinks } from '$lib/test/oracle/wikilinks-pre-1527';
import { MEMORY_EDGES_QUERY, MEMORY_NODES_QUERY } from '$lib/server/queries';

const MEM = 'mem-A';
const MEM_URN = 'hrn:mem:acme.com:mem-a';

const mockRequest = vi.fn();
const docs: string[] = [];
let reads = serveMemoryReads([], { id: MEM, urn: MEM_URN });
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({
    request: (doc: string, vars?: Record<string, unknown>) => {
      docs.push(doc);
      const served = reads(doc, vars);
      return served !== undefined ? Promise.resolve(served) : mockRequest(doc, vars);
    },
  }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  docs.length = 0;
});

const seeded: SeedNode[] = [
  { id: 'specs', loc: 'specs', name: 'Specs' },
  { id: 'auth', loc: 'specs:auth', name: 'Auth' },
  { id: 'jwt', loc: 'specs:auth:jwt', name: 'JWT' },
  { id: 'unnamed', loc: 'specs:unnamed', name: null },
  { id: 'chat', loc: 'chats:c1', name: 'Chat one', nodeType: 'chat' },
  { id: 'msg', loc: 'chats:c1:messages:m1', name: 'm1', nodeType: 'chat-message' },
  { id: 'info', loc: 'notes:n1', name: 'Not a chat', nodeType: 'info' },
  { id: 'fakemsg', loc: 'notes:n1:messages:m2', name: 'm2', nodeType: 'chat-message' },
  // #1438 BLIND P3: chat roots off the standard `chats:<c>` shape.
  { id: 'deepchat', loc: 'teams:t1:chats:design', name: 'Design chat', nodeType: 'chat' },
  { id: 'deepmsg', loc: 'teams:t1:chats:design:messages:007', name: '007', nodeType: 'chat-message' },
  { id: 'thread', loc: 'threads:old', name: 'Old thread', nodeType: 'info', tags: ['team-chat'] },
  { id: 'legacymsg', loc: 'threads:old:messages:1', name: '1', nodeType: 'message' },
  { id: 'nestedmsg', loc: 'chats:c1:messages:m1:messages:r1', name: 'r1', nodeType: 'chat-message' },
  { id: 'foreign', loc: 'other', name: 'Foreign', memoryId: 'mem-B' },
];
const graphNodes = seeded
  .filter((n) => (n.memoryId ?? MEM) === MEM)
  .map((n) => ({ id: n.id, memoryId: MEM, loc: n.loc, name: n.name ?? null, nodeType: n.nodeType ?? 'info', tags: n.tags ?? [] }));

const CONTENT = 'links: [[specs:auth]], [[specs:auth:jwt|JWT]], [[specs:nope]], [[other]], [[chats:c1]]';

function nodeRow(id: string) {
  const n = seeded.find((s) => s.id === id)!;
  return {
    id: n.id, memoryId: MEM, loc: n.loc, name: n.name ?? n.loc,
    nodeType: n.nodeType ?? 'info', alias: null, description: null, content: CONTENT,
    abstract: null, tokens: null, tags: n.tags ?? [], seq: null, data: null, ownerRepo: null,
    isRunnable: null, createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
  };
}

async function runNew(id: string) {
  reads = serveMemoryReads(seeded, { id: MEM, urn: MEM_URN });
  mockRequest.mockResolvedValueOnce({ node: nodeRow(id) });
  const { load } = await import('./+page.server');
  const event = {
    params: { id: MEM, nodeId: id },
    locals: { token: 'tok' },
    url: new URL(`http://localhost/app/memories/${MEM}/nodes/${id}`),
    // The layout as main ships it after #1527: no node list.
    parent: vi.fn().mockResolvedValue({
      graph: { id: MEM, urn: MEM_URN }, nodesOff: true, nodesFailed: false, nodesTotal: null,
      isConsumerMode: false, activeOrgId: 'org-1',
    }),
  } as unknown as Parameters<typeof load>[0];
  return (await load(event)) as unknown as {
    breadcrumb: unknown[];
    openChat: unknown;
    wikilinks: unknown;
    ancestorsKnown: boolean;
  };
}

const oldClient = { request: vi.fn(async () => { throw new Error('the old path made no same-memory request'); }) };

describe('node page reads equal the pre-#1527 in-memory path (3b333cf0^)', () => {
  it.each(['jwt', 'auth', 'specs', 'unnamed', 'chat', 'msg', 'info', 'fakemsg', 'deepchat', 'deepmsg', 'thread', 'legacymsg', 'nestedmsg'])('node %s', async (id) => {
    const got = await runNew(id);
    const node = nodeRow(id);

    expect(got.breadcrumb).toEqual(oldBreadcrumb(graphNodes, { id: MEM }, { urn: MEM_URN }, node));
    expect(got.openChat).toEqual(oldOpenChat(graphNodes, { id: MEM }, node));
    // `[[other]]` exists only in mem-B and is 1 atom, so the old path never
    // made a request; the oracle's client would throw if it did.
    expect(got.wikilinks).toEqual(
      await oldResolveWikilinks(oldClient, [node.content, node.abstract], {
        memoryId: MEM, memoryUrn: MEM_URN, nodes: graphNodes, nodesFailed: false,
      }),
    );
    expect(got.ancestorsKnown).toBe(true);
  });

  it.each([
    ['msg', 'chat'],
    ['deepmsg', 'deepchat'],
    ['legacymsg', 'thread'],
  ])('the oracle comparison is not vacuous: %s opens chat %s', async (id, root) => {
    expect((await runNew(id)).openChat).toMatchObject({ nodeId: root });
  });

  it('issues no memoryNodes or memoryEdges request (acceptance 1)', async () => {
    await runNew('msg');
    expect(docs).not.toContain(MEMORY_NODES_QUERY);
    expect(docs).not.toContain(MEMORY_EDGES_QUERY);
  });
});
