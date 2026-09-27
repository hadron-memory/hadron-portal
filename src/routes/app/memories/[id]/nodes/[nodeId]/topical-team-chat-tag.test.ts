/**
 * #926 (part 2) — a `team-chat` TAG is a topic, not a chat.
 *
 * Two real reproductions render as chat roots on the tag alone:
 * - hrn:node:hadronmemory.com:hadron-server:findings:team-chat-monitor-first-field-run
 *   (an `info` finding, Chip's original report);
 * - hrn:node:hadronmemory.com:core:tasks:chat-catch-up-broadcast (a runnable
 *   `task`, Holger via Chip in team chat #2097).
 *
 * A legacy root is also an ordinary node whose only marker is that tag, so a
 * tagged node is a chat only on POSITIVE evidence of a legacy thread: a direct
 * `message` child, probed with the viewer's token. Holger ruled (team chat
 * #2078) that an EMPTY tag-only legacy root may lose chat UI and first-post
 * support; that cost is pinned here too.
 *
 * Every consumer is exercised: the detail load, both post actions (direct
 * POSTs), the /chat view, and chat-older. Each "not a chat" case is paired with
 * the genuine legacy root that must still be one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_THREAD_PROBE_QUERY, NODE_BY_ID_QUERY } from '$lib/server/queries';
import { probeLegacyThread } from '$lib/server/team-chat';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const MEM = 'mem-1';
beforeEach(() => {
  mockRequest.mockReset();
});

function row(over: Record<string, unknown>) {
  return {
    id: 'pk', memoryId: MEM,
    memory: { id: MEM, urn: 'hrn:mem:hadronmemory.com:x', name: 'x', appId: null },
    name: 'x', alias: null, description: null, content: 'body', abstract: null,
    data: null, properties: null, seq: null, isRunnable: null, role: null, revision: 1,
    createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
    ...over,
  };
}

const topicalFinding = row({
  loc: 'findings:team-chat-monitor-first-field-run', nodeType: 'info',
  tags: ['findings', 'team-chat', 'monitor'],
});
const topicalTask = row({
  loc: 'tasks:chat-catch-up-broadcast', nodeType: 'task', isRunnable: true,
  tags: ['team-chat', 'task'],
});
const legacyRoot = row({ loc: 'team-chat:academy:chat', nodeType: 'info', tags: ['team-chat'] });

type Probe = { findNodes: { total: number | null; hits: Array<{ node: { loc: string; nodeType: string } }> } } | Error;
const NO_THREAD: Probe = { findNodes: { total: 0, hits: [] } };
const threadOf = (loc: string): Probe => ({
  findNodes: { total: 1, hits: [{ node: { loc: `${loc}:messages:2026-06-21T175936Z-iris`, nodeType: 'message' } }] },
});

function answer(node: Record<string, unknown>, probe: Probe) {
  mockRequest.mockImplementation(async (doc: string) => {
    if (doc === NODE_BY_ID_QUERY) return { node };
    if (doc === LEGACY_THREAD_PROBE_QUERY) {
      if (probe instanceof Error) throw probe;
      return probe;
    }
    if (/findNodes/.test(doc)) return { findNodes: { total: 0, hits: [] } };
    return { memories: { items: [], total: 0 } };
  });
}

const probeCalls = () => mockRequest.mock.calls.filter(([d]) => d === LEGACY_THREAD_PROBE_QUERY);
const writes = () => mockRequest.mock.calls.map(([d]) => d as string).filter((d) => /\bmutation\b/.test(d));

describe('probeLegacyThread', () => {
  const client = { request: mockRequest } as never;
  const probe = (p: Probe) => {
    answer(legacyRoot, p);
    return probeLegacyThread(client, MEM, 'team-chat:academy:chat');
  };

  it('present: a DIRECT legacy message child', async () => {
    expect(await probe(threadOf('team-chat:academy:chat'))).toBe('present');
    expect(probeCalls()[0][1]).toEqual({ memoryId: MEM, locPrefix: 'team-chat:academy:chat:messages:', limit: 50 });
  });

  it('absent: the complete answer holds none', async () => {
    expect(await probe(NO_THREAD)).toBe('absent');
  });

  it('a DEEPER descendant is not a thread message', async () => {
    const deep = { findNodes: { total: 1, hits: [{ node: { loc: 'team-chat:academy:chat:messages:a:attachment', nodeType: 'message' } }] } };
    expect(await probe(deep)).toBe('absent');
  });

  it('unknown: a truncated window with no direct message in it is not evidence either way', async () => {
    const truncated = { findNodes: { total: 500, hits: [{ node: { loc: 'team-chat:academy:chat:messages:a:b', nodeType: 'message' } }] } };
    expect(await probe(truncated)).toBe('unknown');
  });

  it('unknown: a failed read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await probe(new Error('boom'))).toBe('unknown');
    warn.mockRestore();
  });
});

const TOPICAL = [['the topical info finding', topicalFinding], ['the topical runnable task', topicalTask]] as const;

describe('node detail load', () => {
  async function load(node: Record<string, unknown>, probe: Probe = NO_THREAD) {
    answer(node, probe);
    const { load } = await import('./+page.server');
    return (await load({
      params: { id: MEM, nodeId: 'pk' },
      locals: { token: 'tok' },
      url: new URL(`http://localhost/app/memories/${MEM}/nodes/pk`),
      parent: vi.fn().mockResolvedValue({
        graphNodes: [], graph: { id: MEM, urn: 'hrn:mem:hadronmemory.com:x', appId: null },
        isConsumerMode: false, activeOrgId: 'org-1',
      }),
    } as never)) as unknown as { isChat: boolean; canPostChat: boolean; isChatMessage: boolean };
  }

  it.each(TOPICAL)('%s tagged team-chat gets no Chat Node label, tab or composer', async (_n, node) => {
    const data = await load(node);
    expect(data.isChat).toBe(false);
    expect(data.canPostChat).toBe(false);
    expect(data.isChatMessage).toBe(false);
  });

  it('a genuine legacy root, with its thread, keeps its Chat tab and composer', async () => {
    const data = await load(legacyRoot, threadOf('team-chat:academy:chat'));
    expect(data.isChat).toBe(true);
    expect(data.canPostChat).toBe(true);
  });

  it('an EMPTY tag-only legacy root loses its chat UI (the cost Holger accepted, #2078)', async () => {
    const data = await load(legacyRoot, NO_THREAD);
    expect(data.isChat).toBe(false);
    expect(data.canPostChat).toBe(false);
  });

  it('a failed probe is not evidence: no chat UI', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const data = await load(legacyRoot, new Error('boom'));
    expect(data.isChat).toBe(false);
    warn.mockRestore();
  });

  it('an untagged node pays NO extra round trip, and a platform root is not probed', async () => {
    await load(row({ loc: 'notes:x', nodeType: 'info', tags: ['other'] }));
    await load(row({ loc: 'chats:team', nodeType: 'chat', tags: ['team-chat'] }));
    expect(probeCalls()).toHaveLength(0);
  });
});

describe('direct POSTs refuse a topical node and write nothing', () => {
  function form() {
    const fd = new FormData();
    fd.set('_kind', 'sendChatMessage');
    fd.set('content', 'hello');
    return fd;
  }
  const event = () => ({
    request: { formData: async () => form() },
    params: { id: MEM, nodeId: 'pk' },
    locals: { token: 'tok', user: { handle: 'holger' } },
  }) as never;

  it.each(TOPICAL)('the node page action, for %s', async (_n, node) => {
    answer(node, NO_THREAD);
    const { actions } = await import('./+page.server');
    const result = (await (actions as Record<string, (e: never) => Promise<unknown>>).sendChatMessage(event())) as { status: number };
    expect(result.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it.each(TOPICAL)('the /chat view action, for %s', async (_n, node) => {
    answer(node, NO_THREAD);
    const { actions } = await import('./chat/+page.server');
    const result = (await (actions as Record<string, (e: never) => Promise<unknown>>).sendMessage(event())) as { status: number };
    expect(result.status).toBe(400);
    expect(writes()).toEqual([]);
  });

  it('the node page action still posts to a genuine legacy root', async () => {
    answer(legacyRoot, threadOf('team-chat:academy:chat'));
    const { actions } = await import('./+page.server');
    await (actions as Record<string, (e: never) => Promise<unknown>>).sendChatMessage(event());
    expect(writes()).toHaveLength(1);
  });
});

describe('/chat view load and chat-older', () => {
  it.each(TOPICAL)('the /chat view redirects %s back to its node page', async (_n, node) => {
    answer(node, NO_THREAD);
    const { load } = await import('./chat/+page.server');
    let thrown: unknown;
    try {
      await load({
        params: { id: MEM, nodeId: 'pk' },
        locals: { token: 'tok' },
        url: new URL(`http://localhost/app/memories/${MEM}/nodes/pk/chat`),
        parent: vi.fn().mockResolvedValue({ graph: { id: MEM, urn: 'hrn:mem:hadronmemory.com:x' }, graphNodes: [] }),
      } as never);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toMatchObject({ status: 303, location: `/app/memories/${MEM}/nodes/pk` });
  });

  it.each(TOPICAL)('chat-older answers 404 not-a-chat for %s', async (_n, node) => {
    answer(node, NO_THREAD);
    const { GET } = await import('./chat-older/+server');
    const res = await GET({ params: { id: MEM, nodeId: 'pk' }, url: new URL('http://localhost/x?before=50'), locals: { token: 'tok' } } as never);
    expect(res.status).toBe(404);
  });

  it('chat-older still serves a genuine legacy root', async () => {
    answer(legacyRoot, threadOf('team-chat:academy:chat'));
    const { GET } = await import('./chat-older/+server');
    const res = await GET({ params: { id: MEM, nodeId: 'pk' }, url: new URL('http://localhost/x?before=50'), locals: { token: 'tok' } } as never);
    expect(res.status).toBe(200);
  });
});
