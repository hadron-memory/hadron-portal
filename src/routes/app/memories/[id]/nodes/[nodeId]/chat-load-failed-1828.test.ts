/**
 * portal#1828: a rejected chat read must reach the page as a FAILED load, not as an empty thread.
 * Both loaders that share the collapse (full-screen chat route and the node-detail inline chat).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { serveMemoryReads } from '$lib/test/serveMemoryReads';

const reads = serveMemoryReads([], { id: 'mem-1', urn: 'hrn:mem:acme.com:notes' });
const mockRequest = vi.fn();
const mockLoadChatMessages = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));
vi.mock('$lib/server/team-chat', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  loadChatMessages: (...a: unknown[]) => mockLoadChatMessages(...a),
}));

const chatRow = {
  id: 'chat-pk', memoryId: 'mem-1', memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:notes', name: 'notes', appId: null },
  loc: 'chats:team', name: 'Team chat', nodeType: 'chat', alias: null, description: null, content: null, abstract: null,
  data: null, properties: null, tags: [], seq: null, isRunnable: null, createdAt: '', updatedAt: '', outgoingEdges: [], incomingEdges: [],
};
const PAGE = { messages: [{ id: 'm1', content: 'hi' }], total: 1, hasOlder: false, offset: 0 };

beforeEach(() => {
  mockRequest.mockReset();
  mockLoadChatMessages.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    const served = reads(doc, vars);
    if (served !== undefined) return served;
    if (doc === NODE_BY_ID_QUERY) return { node: chatRow };
    return { memories: { items: [], total: 0 }, nodes: { items: [], total: 0 } };
  });
});

const parent = () => vi.fn().mockResolvedValue({ graphNodes: [], graph: { id: 'mem-1', urn: 'hrn:mem:acme.com:notes', appId: null }, isConsumerMode: false, activeOrgId: 'org-1' });

async function fullScreen() {
  const { load } = await import('./chat/+page.server');
  return (await load({ params: { id: 'mem-1', nodeId: 'chat-pk' }, locals: { token: 'tok' }, url: new URL('http://localhost/app/memories/mem-1/nodes/chat-pk/chat'), parent: parent() } as never)) as unknown as Record<string, unknown>;
}
async function inline() {
  const { load } = await import('./+page.server');
  return (await load({ params: { id: 'mem-1', nodeId: 'chat-pk' }, locals: { token: 'tok' }, url: new URL('http://localhost/app/memories/mem-1/nodes/chat-pk'), parent: parent() } as never)) as unknown as Record<string, unknown>;
}

describe.each([
  ['full-screen chat route', fullScreen, 'chatLoadFailed'],
  ['node-detail inline chat', inline, 'chatLoadFailed'],
])('portal#1828 %s', (_name, run, flag) => {
  it('a rejected read is flagged as a failed load, never as an empty thread alone', async () => {
    mockLoadChatMessages.mockRejectedValue(new Error('boom'));
    const data = await run();
    expect(data[flag]).toBe(true);
  });

  it('control: a successful read is not flagged', async () => {
    mockLoadChatMessages.mockResolvedValue(PAGE);
    expect((await run())[flag]).not.toBe(true);
  });

  it('control: a genuinely empty thread is not a failure', async () => {
    mockLoadChatMessages.mockResolvedValue({ messages: [], total: 0, hasOlder: false, offset: 0 });
    expect((await run())[flag]).not.toBe(true);
  });
});
