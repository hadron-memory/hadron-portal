/**
 * portal#1665 Ask 2-4 — GET /api/served-prompts: the one read-only door for the served-record
 * views (worker, session, run, chat). A record names WHAT a bind/run/chat was given: ids,
 * revisions, hashes, recorded variables. Never source text, never a name from the record.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const SENTINEL_CONTENT = 'sentinel-source-text-DO-NOT-LEAK';

const rec = (over: Record<string, unknown> = {}) => ({
  id: 'rec-1',
  kind: 'BIND',
  ordinal: 1,
  pointerLevel: 'WORKER',
  servedAt: '2026-11-04T10:00:00.000Z',
  servedRevSeq: 7,
  provenanceRevSeq: 7,
  pruned: false,
  compiledNodeId: 'node-1',
  compiledContentHash: 'abc123',
  variables: { worker: 'x' },
  provenance: { items: [{ revSeq: 3, hash: 'h1', pruned: false }, { revSeq: 2, hash: 'h2', pruned: true }], total: 2 },
  currentLint: { items: [], nextCursor: null, total: 0 },
  ...over,
});

const get = async (qs: string) => {
  const { GET } = await import('./+server');
  return GET({ url: new URL(`http://localhost/api/served-prompts?${qs}`), locals: { token: 't' } } as never);
};

/** Route requests by the query text. */
function route(handlers: { served?: (q: string, v: Record<string, unknown>) => unknown; names?: unknown; chats?: unknown }) {
  request.mockImplementation(async (q: string, v: Record<string, unknown>) => {
    if (q.includes('nodeBatch')) {
      if (handlers.names instanceof Error) throw handlers.names;
      return handlers.names ?? { nodeBatch: { nodes: [] } };
    }
    if (q.includes('myChats')) return v.offset ? { myChats: [] } : (handlers.chats ?? { myChats: [] });
    return handlers.served?.(q, v);
  });
}

beforeEach(() => {
  request.mockReset();
});

describe('request shape', () => {
  it('401 without a token, and 400 on a bad source', async () => {
    const { GET } = await import('./+server');
    const res = await GET({ url: new URL('http://localhost/api/served-prompts?source=worker&ref=w'), locals: {} } as never);
    expect(res.status).toBe(401);
    expect((await get('source=bogus&ref=x')).status).toBe(400);
    expect((await get('source=worker')).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
});

describe('worker / run: at most one record', () => {
  it('worker: returns the record with the viewer-read name, total 1', async () => {
    route({
      served: () => ({ worker: { servedPrompt: rec() } }),
      names: { nodeBatch: { nodes: [{ id: 'node-1', urn: 'hrn:node:x:y:boot', name: 'Boot' }] } },
    });
    const res = await get('source=worker&ref=w1');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0]).toMatchObject({
      id: 'rec-1', kind: 'BIND', pointerLevel: 'WORKER', servedRevSeq: 7, pruned: false,
      node: { urn: 'hrn:node:x:y:boot', name: 'Boot' },
      variables: { worker: 'x' },
    });
    expect(body.items[0].provenance.items).toEqual([{ revSeq: 3, hash: 'h1', pruned: false }, { revSeq: 2, hash: 'h2', pruned: true }]);
  });

  it('worker with no record (or none readable): 200 with an empty page, never an error', async () => {
    route({ served: () => ({ worker: { servedPrompt: null } }) });
    const res = await get('source=worker&ref=w1');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ items: [], total: 0 });
  });

  it('run: reads appRun.servedPrompt', async () => {
    route({ served: (q) => { expect(q).toContain('appRun'); return { appRun: { servedPrompt: rec({ kind: 'RUN' }) } }; } });
    const body = await (await get('source=run&ref=r1')).json();
    expect(body.items[0].kind).toBe('RUN');
  });
});

describe('names come from an independent viewer read and never carry content', () => {
  it('selects id urn name only, never content, and asks for the compiled node id', async () => {
    route({ served: () => ({ worker: { servedPrompt: rec() } }) });
    await get('source=worker&ref=w1');
    const nameCall = request.mock.calls.find(([q]) => String(q).includes('nodeBatch'))!;
    expect(String(nameCall[0])).not.toMatch(/content|raw|body|text/i);
    expect(String(nameCall[0])).toMatch(/id\s+urn\s+name/);
    expect(nameCall[1]).toEqual({ refs: ['node-1'] });
  });

  it('an unavailable node => no name and no chip (node: null); the record still renders', async () => {
    route({
      served: () => ({ worker: { servedPrompt: rec() } }),
      names: { nodeBatch: { nodes: [], unavailable: ['node-1'] } },
    });
    const body = await (await get('source=worker&ref=w1')).json();
    expect(body.items[0].node).toBeNull();
  });

  it('a failed name read => node: null, not a failed section', async () => {
    route({ served: () => ({ worker: { servedPrompt: rec() } }), names: new Error('boom') });
    const res = await get('source=worker&ref=w1');
    expect(res.status).toBe(200);
    expect((await res.json()).items[0].node).toBeNull();
  });

  it('a node batch entry is trimmed to id/urn/name (extra fields do not pass through)', async () => {
    route({
      served: () => ({ worker: { servedPrompt: rec() } }),
      names: { nodeBatch: { nodes: [{ id: 'node-1', urn: 'hrn:node:x:y:boot', name: 'Boot', content: SENTINEL_CONTENT }] } },
    });
    const text = await (await get('source=worker&ref=w1')).text();
    expect(text).not.toContain(SENTINEL_CONTENT);
  });

  it('provenance entries carry revision/hash/pruned only: no name, no urn, no lookup of them', async () => {
    route({ served: () => ({ worker: { servedPrompt: rec() } }) });
    const body = await (await get('source=worker&ref=w1')).json();
    for (const e of body.items[0].provenance.items) expect(Object.keys(e).sort()).toEqual(['hash', 'pruned', 'revSeq']);
    const nameCall = request.mock.calls.find(([q]) => String(q).includes('nodeBatch'))!;
    expect(nameCall[1].refs).toEqual(['node-1']);
  });
});

describe('lint', () => {
  it('null currentLint => lint: null (unavailable), distinct from an empty warning list', async () => {
    route({ served: () => ({ worker: { servedPrompt: rec({ currentLint: null }) } }) });
    expect((await (await get('source=worker&ref=w1')).json()).items[0].lint).toBeNull();
    route({ served: () => ({ worker: { servedPrompt: rec() } }) });
    expect((await (await get('source=worker&ref=w1')).json()).items[0].lint).toMatchObject({ items: [], total: 0, nextCursor: null });
  });

  it('asks for the first 20 warnings and passes lintAfter as the cursor', async () => {
    route({ served: () => ({ worker: { servedPrompt: rec() } }) });
    await get('source=worker&ref=w1&lintAfter=cur-9');
    const call = request.mock.calls.find(([q]) => String(q).includes('WorkerServedPrompt'))!;
    expect(call[1]).toMatchObject({ lintFirst: 20, lintAfter: 'cur-9' });
  });
});

describe('paging', () => {
  it('provenance: 20 per page with the requested offset', async () => {
    route({ served: () => ({ worker: { servedPrompt: rec() } }) });
    const body = await (await get('source=worker&ref=w1&provOffset=40')).json();
    const call = request.mock.calls.find(([q]) => String(q).includes('WorkerServedPrompt'))!;
    expect(call[1]).toMatchObject({ provLimit: 20, provOffset: 40 });
    expect(body.items[0].provenance).toMatchObject({ total: 2, offset: 40 });
  });

  it('session: records limit 5, offset honoured, total carried through (no hasMore)', async () => {
    route({ served: () => ({ session: { servedPrompts: { items: [rec(), rec({ id: 'rec-2' })], total: 12 } } }) });
    const body = await (await get('source=session&ref=s1&offset=5')).json();
    const call = request.mock.calls.find(([q]) => String(q).includes('SessionServedPrompts'))!;
    expect(call[1]).toMatchObject({ id: 's1', limit: 5, offset: 5 });
    expect(body).toMatchObject({ total: 12, offset: 5 });
    expect(body.items).toHaveLength(2);
  });

  it('a limit above 5 is clamped to 5; a malformed offset becomes 0', async () => {
    route({ served: () => ({ session: { servedPrompts: { items: [], total: 0 } } }) });
    await get('source=session&ref=s1&limit=500&offset=-3');
    const call = request.mock.calls.find(([q]) => String(q).includes('SessionServedPrompts'))!;
    expect(call[1]).toMatchObject({ limit: 5, offset: 0 });
  });

  it('a session the viewer cannot read (null) is an empty page', async () => {
    route({ served: () => ({ session: null }) });
    expect(await (await get('source=session&ref=s1')).json()).toMatchObject({ items: [], total: 0 });
  });
});

describe('chat: addressed by the viewer\'s own list, never a browser-supplied id', () => {
  const chats = { myChats: [{ id: 'row-id-1', loc: 'chat-loc-1' }] };

  it('finds the chat by loc in the viewer\'s myChats and sends only that row id', async () => {
    route({ chats, served: () => ({ chatServedPrompts: { items: [rec({ kind: 'CHAT' })], total: 1 } }) });
    const res = await get('source=chat&agentId=agent-1&chatId=chat-loc-1');
    expect(res.status).toBe(200);
    const call = request.mock.calls.find(([q]) => String(q).includes('chatServedPrompts'))!;
    expect(call[1]).toMatchObject({ chatId: 'row-id-1' });
    expect((await res.json()).items[0].kind).toBe('CHAT');
  });

  it('a chat not in the viewer\'s list is 404 "Chat not found" with NO served-prompt read', async () => {
    route({ chats, served: () => { throw new Error('must not be called'); } });
    const res = await get('source=chat&agentId=agent-1&chatId=someone-elses-chat');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Chat not found' });
    expect(request.mock.calls.some(([q]) => String(q).includes('chatServedPrompts'))).toBe(false);
  });

  it('a browser-supplied row id is not accepted as the chat (loc lookup only)', async () => {
    route({ chats, served: () => { throw new Error('must not be called'); } });
    const res = await get('source=chat&agentId=agent-1&chatId=row-id-1');
    expect(res.status).toBe(404);
  });

  it('needs agentId and chatId', async () => {
    expect((await get('source=chat&agentId=agent-1')).status).toBe(400);
    expect((await get('source=chat&chatId=c')).status).toBe(400);
  });
});

describe('failure is a fixed message, never an empty list', () => {
  it('logs only the error code, never the error object (a ClientError embeds response errors and request variables)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    route({ served: () => { throw { message: `leak ${SENTINEL_CONTENT}`, request: { variables: { ref: SENTINEL_CONTENT } }, response: { errors: [{ message: SENTINEL_CONTENT, extensions: { code: 'X_CODE' } }] } }; } });
    await get('source=worker&ref=w1');
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).not.toContain(SENTINEL_CONTENT);
    expect(logged).toContain('X_CODE');
  });

  it('a GraphQL failure => 502 with one fixed message and no server text', async () => {
    route({ served: () => { throw { response: { errors: [{ message: `leak ${SENTINEL_CONTENT}` }] } }; } });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await get('source=worker&ref=w1');
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "Couldn't load the served prompt." });
    expect(text).not.toContain(SENTINEL_CONTENT);
  });

  it('a chat-list failure => the same fixed 502', async () => {
    request.mockRejectedValue(new Error('down'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const res = await get('source=chat&agentId=a&chatId=c');
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Couldn't load the served prompt." });
  });
});
