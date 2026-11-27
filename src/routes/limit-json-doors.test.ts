import { beforeEach, describe, expect, it, vi } from 'vitest';

/** #2569 (C3): the JSON and handler doors that carry no page test of their own. Each answers the server's text with 409 or 400. */
const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.spyOn(console, 'error').mockImplementation(() => {});

const wire = (ext: Record<string, unknown>, message: string) => ({ response: { errors: [{ message, extensions: ext }] } });
const REACHED = wire({ code: 'OWNER_LIMIT_REACHED', limitKey: 'nodes', ownerType: 'user', callerCanManageOwner: false }, 'The owner of this memory has reached a limit of their account.');
const REACHED_TEXT = 'The owner of this memory has reached a limit of their account.';
const TOO_LARGE = wire({ code: 'NODE_CONTENT_TOO_LARGE', maxBytes: 100 }, 'A node can hold at most 100 bytes.');

const nodeRow = { id: 'n1', memoryId: 'm1', loc: 'a', name: 'a', nodeType: 'info', tags: [], memory: { urn: 'hrn:mem:o:m' }, outgoingEdges: [], incomingEdges: [] };

function post(body: unknown, params: Record<string, string> = {}) {
  return { request: { json: async () => body }, locals: { token: 't' }, params } as never;
}
beforeEach(() => { mockRequest.mockReset(); });

describe('JSON doors answer the server text (door numbers per the issue)', () => {
  it('door 12, move endpoint: 409 for a limit (on main: 500)', async () => {
    mockRequest.mockResolvedValueOnce({ node: nodeRow }).mockRejectedValueOnce(REACHED);
    const { POST } = await import('./api/nodes/move/+server');
    const res = await POST(post({ sourceRef: 'n1', toLoc: 'b' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: REACHED_TEXT, code: 'OWNER_LIMIT_REACHED' });
  });
  it('door 13, reorder endpoint: 400 for size (on main: 500)', async () => {
    mockRequest.mockImplementation(async (_d: unknown, v?: { input?: unknown }) => { if (v?.input) throw TOO_LARGE; return { node: nodeRow }; });
    const { POST } = await import('./api/nodes/reorder/+server');
    const res = await POST(post({ memoryId: 'm1', updates: [{ id: 'n1', seq: 1 }] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('A node can hold at most 100 bytes.');
  });
  it('door 9, memory clone: 409 (on main: 500)', async () => {
    mockRequest.mockRejectedValueOnce(REACHED);
    const { POST } = await import('./app/memories/[id]/clone/+server');
    const res = await POST(post({ targetUrn: 'hrn:mem:o:new' }, { id: 'm1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(REACHED_TEXT);
  });
  it('door 15, node revision restore: 400 for size (on main: 500)', async () => {
    mockRequest.mockRejectedValueOnce(TOO_LARGE);
    const { POST } = await import('./app/memories/[id]/nodes/[nodeId]/revisions/+server');
    const res = await POST(post({ action: 'restore', revisionId: 'r1' }, { id: 'm1', nodeId: 'n1' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('A node can hold at most 100 bytes.');
  });
  it('door 17, agent snapshot: 409 (on main: 500)', async () => {
    mockRequest.mockRejectedValueOnce(REACHED);
    const { POST } = await import('./api/agent-chat/revisions/+server');
    const res = await POST(post({ action: 'save', agentId: 'a1' }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe(REACHED_TEXT);
  });
  it('door 14, node restore: 409 with the server text', async () => {
    mockRequest.mockRejectedValueOnce(REACHED);
    const { actions } = await import('./app/memories/[id]/nodes/[nodeId]/deleted/+page.server');
    const res = (await actions.restore({ params: { id: 'm1', nodeId: 'n1' }, locals: { token: 't' } } as never)) as { status: number; data: { error: string } };
    expect(res.status).toBe(409);
    expect(res.data.error).toBe(REACHED_TEXT);
  });
});
