import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

const REC = (id: string, extra: Record<string, unknown> = {}) => ({
  id, kind: 'BIND', ordinal: 1, pointerLevel: 'APP_AGENT', servedAt: '2026-11-04T00:00:00Z', servedRevSeq: 4, provenanceRevSeq: 4,
  pruned: false, compiledNodeId: 'node-1', compiledContentHash: 'sha-abc', variables: { a: 1 },
  provenance: { items: [{ revSeq: 2, hash: 'h', pruned: false }], total: 1 },
  currentLint: { items: [], nextCursor: null, total: 0 }, ...extra,
});
const GET = async (qs: string, token: string | null = 't') => {
  const { GET } = await import('./+server');
  const res = await GET({ url: new URL(`http://x/api/served-prompts?${qs}`), locals: { token } } as never);
  return { status: res.status, body: JSON.parse(await res.text()) };
};
const calls = () => mockRequest.mock.calls.map(([q]) => String(q));
beforeEach(() => mockRequest.mockReset());

describe('GET /api/served-prompts', () => {
  it('401 without a token, 400 without a source', async () => {
    expect((await GET('source=worker&ref=w', null)).status).toBe(401);
    expect((await GET('ref=w')).status).toBe(400);
    expect((await GET('source=nope&ref=w')).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a worker with a record: the view carries the name only from the independent nodeBatch, never the ids', async () => {
    mockRequest
      .mockResolvedValueOnce({ worker: { servedPrompt: REC('r1') } })
      .mockResolvedValueOnce({ nodeBatch: { nodes: [{ id: 'node-1', urn: 'hrn:node:x:y:boot', name: 'Boot' }] } });
    const { status, body } = await GET('source=worker&ref=w1');
    expect(status).toBe(200);
    expect(body.items[0].node).toEqual({ urn: 'hrn:node:x:y:boot', name: 'Boot' });
    expect(JSON.stringify(body)).not.toContain('compiledNodeId');
    expect(JSON.stringify(body.items[0])).not.toContain('"node-1"');
    // No request selects content.
    for (const q of calls()) expect(q).not.toMatch(/\bcontent\b/);
    expect(calls()[1]).toContain('nodeBatch');
  });

  it('a node the viewer cannot read yields neither name nor chip, even though the record names its id', async () => {
    mockRequest.mockResolvedValueOnce({ worker: { servedPrompt: REC('r1') } }).mockResolvedValueOnce({ nodeBatch: { nodes: [] } });
    expect((await GET('source=worker&ref=w1')).body.items[0].node).toBeNull();
  });

  it('a failed name read degrades to no name, not a failed section', async () => {
    mockRequest.mockResolvedValueOnce({ worker: { servedPrompt: REC('r1') } }).mockRejectedValueOnce(new Error('boom'));
    const { status, body } = await GET('source=worker&ref=w1');
    expect(status).toBe(200);
    expect(body.items[0].node).toBeNull();
  });

  it('null record = concealment: empty items, no error, and no name read is made', async () => {
    mockRequest.mockResolvedValueOnce({ worker: { servedPrompt: null } });
    const { status, body } = await GET('source=worker&ref=w1');
    expect(status).toBe(200);
    expect(body).toEqual({ items: [], total: 0, offset: 0 });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('null currentLint is reported as null (unavailable), never an empty list', async () => {
    mockRequest.mockResolvedValueOnce({ appRun: { servedPrompt: REC('r1', { currentLint: null }) } }).mockResolvedValueOnce({ nodeBatch: { nodes: [] } });
    expect((await GET('source=run&ref=run1')).body.items[0].lint).toBeNull();
  });

  it('a GraphQL failure is a 502 with one fixed message, not an empty section, and leaks nothing', async () => {
    mockRequest.mockRejectedValueOnce(Object.assign(new Error('SECRET-prose'), { response: { errors: [{ message: 'SECRET-prose' }] } }));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { status, body } = await GET('source=session&ref=s1');
    expect(status).toBe(502);
    expect(body).toEqual({ error: "Couldn't load the served prompt." });
  });

  it('session paging passes limit 5 and the requested offsets through', async () => {
    mockRequest.mockResolvedValueOnce({ session: { servedPrompts: { items: [REC('r6')], total: 12 } } }).mockResolvedValueOnce({ nodeBatch: { nodes: [] } });
    const { body } = await GET('source=session&ref=s1&offset=5&provOffset=20&lintAfter=cur');
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ id: 's1', limit: 5, offset: 5, provLimit: 20, provOffset: 20, lintFirst: 20, lintAfter: 'cur' });
    expect(body.total).toBe(12);
    expect(body.offset).toBe(5);
  });

  describe('chat', () => {
    it('reads chatServedPrompts only with the id of a row in the viewer\'s own myChats', async () => {
      mockRequest
        .mockResolvedValueOnce({ myChats: [{ id: 'row-id-9', loc: 'chat-loc' }] })
        .mockResolvedValueOnce({ chatServedPrompts: { items: [REC('r1', { kind: 'CHAT' })], total: 1 } })
        .mockResolvedValueOnce({ nodeBatch: { nodes: [] } });
      const { status } = await GET('source=chat&agentId=a1&chatId=chat-loc&ref=attacker-chosen-id');
      expect(status).toBe(200);
      expect(mockRequest.mock.calls[1][1]).toMatchObject({ chatId: 'row-id-9' });
      expect(JSON.stringify(mockRequest.mock.calls)).not.toContain('attacker-chosen-id');
    });

    it('a loc that is not in myChats is 404 and makes no served-prompt read', async () => {
      mockRequest.mockResolvedValueOnce({ myChats: [{ id: 'other', loc: 'someone-elses' }] }).mockResolvedValueOnce({ myChats: [] });
      const { status, body } = await GET('source=chat&agentId=a1&chatId=chat-loc');
      expect(status).toBe(404);
      expect(body.error).toBe('Chat not found');
      expect(calls().some((q) => q.includes('chatServedPrompts'))).toBe(false);
    });

    it('an end user who does not manage the App gets an empty page: no error', async () => {
      mockRequest.mockResolvedValueOnce({ myChats: [{ id: 'row', loc: 'c' }] }).mockResolvedValueOnce({ chatServedPrompts: { items: [], total: 0 } });
      const { status, body } = await GET('source=chat&agentId=a1&chatId=c');
      expect(status).toBe(200);
      expect(body.items).toEqual([]);
    });
  });
});
