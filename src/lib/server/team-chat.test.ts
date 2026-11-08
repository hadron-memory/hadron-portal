import { describe, expect, it, vi } from 'vitest';
import {
  CREATE_NODE_MUTATION,
  CREATE_TEAM_CHAT_MESSAGE_MUTATION,
  NODES_BY_LOC_PREFIX_QUERY,
} from '$lib/server/queries';
import {
  CHAT_PAGE_SIZE,
  chatAuthorName,
  chatPostTarget,
  chatRootLocForMessage,
  chatSortKey,
  isChatMessageNode,
  isChatNode,
  loadChatMessages,
  locSafeAuthor,
  messagesPrefix,
  postChatMessage,
} from '$lib/server/team-chat';
import type { MemoryNode } from '$lib/types';

function msg(loc: string, over: Partial<MemoryNode> = {}): MemoryNode {
  return {
    id: loc, loc, name: 'holger', nodeType: 'chat-message',
    createdAt: '2026-08-14T10:00:00Z', seq: null, content: null, data: null, ...over,
  } as unknown as MemoryNode;
}

function clientReturning(hits: MemoryNode[]) {
  // #793: `total` is part of the contract now — it is what makes a TAIL window
  // addressable. A mock without it would send loadChatMessages down the
  // `?? hits.length` fallback and quietly test a different path than production.
  return {
    request: vi.fn().mockResolvedValue({
      findNodes: { total: hits.length, hits: hits.map((node) => ({ node })) },
    }),
  } as any;
}

describe('isChatNode', () => {
  it('accepts the platform `chat` nodeType, and a `team-chat` tag only WITH a legacy thread (#926)', () => {
    expect(isChatNode({ nodeType: 'chat', tags: [] } as unknown as MemoryNode)).toBe(true);
    const tagged = { nodeType: 'info', loc: 'notes:x', tags: ['team-chat'] } as unknown as MemoryNode;
    expect(isChatNode(tagged)).toBe(false);
    expect(isChatNode(tagged, { legacyThread: false })).toBe(false);
    expect(isChatNode(tagged, { legacyThread: true })).toBe(true);
    expect(isChatNode({ nodeType: 'info', tags: ['chat'] } as unknown as MemoryNode)).toBe(false);
    expect(isChatNode({ nodeType: 'chat-message', tags: [] } as unknown as MemoryNode)).toBe(false);
    expect(isChatNode(null)).toBe(false);
  });
});

// #726. The chat root is the destination of the message page's "Open chat",
// and it is derived from the loc rather than fetched, so the derivation is the
// whole correctness of that link.
describe('chatRootLocForMessage', () => {
  it('is the inverse of messagesPrefix', () => {
    expect(chatRootLocForMessage(`${messagesPrefix('chats:team')}003-Iris`)).toBe('chats:team');
    expect(chatRootLocForMessage(`${messagesPrefix('a')}x`)).toBe('a');
  });

  it('cuts at the LAST :messages:, so a chat whose own loc contains it still resolves', () => {
    // The chat root here is `archive:messages:2024`; cutting at the first
    // boundary would name `archive` — a different node, silently.
    expect(chatRootLocForMessage('archive:messages:2024:messages:007-Gil')).toBe(
      'archive:messages:2024',
    );
  });

  it('refuses an address that is not a DIRECT message of a chat', () => {
    // The same "direct children only" rule loadChatMessages applies, so the
    // two agree about what belongs to a thread.
    expect(chatRootLocForMessage('chats:team:messages:007:reactions:a')).toBeNull();
    expect(chatRootLocForMessage('chats:team:messages:')).toBeNull();
    expect(chatRootLocForMessage('chats:team')).toBeNull();
    expect(chatRootLocForMessage('messages:007')).toBeNull(); // nothing to be the root
    expect(chatRootLocForMessage(null)).toBeNull();
    expect(chatRootLocForMessage('')).toBeNull();
  });

  it('agrees with loadChatMessages about which locs are messages of a chat', async () => {
    // Pin the pair rather than assert each alone: these two are the reason the
    // mark and the thread cannot disagree, and nothing else enforces it.
    const chatLoc = 'chats:team';
    const locs = [
      `${messagesPrefix(chatLoc)}001-Ada`, // a message
      `${messagesPrefix(chatLoc)}002:draft`, // nested — not a message
      `${chatLoc}:notes`, // not under the prefix at all
    ];
    const client = clientReturning(locs.map((l) => msg(l)));
    const loaded = (await loadChatMessages(client, 'mem-1', chatLoc)).messages;
    const rendered = new Set(loaded.map((m) => m.nodeData.loc));

    for (const loc of locs) {
      expect(chatRootLocForMessage(loc) === chatLoc).toBe(rendered.has(loc));
    }
  });
});

describe('isChatMessageNode', () => {
  it('accepts the platform type on its own — `chat-message` is unambiguous', () => {
    expect(isChatMessageNode({ nodeType: 'chat-message', loc: 'anywhere' } as MemoryNode)).toBe(true);
  });

  it('requires the legacy `message` type to ALSO be addressed as one', () => {
    // `message` is a generic word another corpus may use for something that is
    // not a chat. Marking such a node "Chat Message:" renders perfectly and
    // says something false — hrn:node:hadronmemory.com:hadron-portal:review:a-fallback-asserts-what-it-was-written-for.
    expect(isChatMessageNode({ nodeType: 'message', loc: 'chats:team:messages:001' } as MemoryNode)).toBe(true);
    expect(isChatMessageNode({ nodeType: 'message', loc: 'inbox:draft' } as MemoryNode)).toBe(false);
  });

  it('is false for a chat ROOT and for an ordinary node', () => {
    expect(isChatMessageNode({ nodeType: 'chat', loc: 'chats:team' } as MemoryNode)).toBe(false);
    expect(isChatMessageNode({ nodeType: 'info', loc: 'chats:team:messages:001' } as MemoryNode)).toBe(false);
    expect(isChatMessageNode(null)).toBe(false);
  });

  it('never overlaps isChatNode — a node cannot be both the thread and a bubble', () => {
    const cases = [
      { nodeType: 'chat', loc: 'chats:team', tags: [] },
      { nodeType: 'chat-message', loc: 'chats:team:messages:001', tags: [] },
      { nodeType: 'message', loc: 'chats:team:messages:001', tags: [] },
      { nodeType: 'info', loc: 'notes', tags: ['team-chat'] },
    ];
    for (const c of cases) {
      expect(isChatNode(c as unknown as MemoryNode) && isChatMessageNode(c as unknown as MemoryNode)).toBe(false);
    }
  });
});

describe('loadChatMessages', () => {
  it('queries the `<loc>:messages:` prefix within the memory, sorted by seq', async () => {
    const client = clientReturning([]);
    await loadChatMessages(client, 'mem-1', 'chats:team');

    // #793: a bounded window rather than `limit: 2000`, and `sort: 'seq'` —
    // NOT `loc`. The server pads the seq atom to three digits, so `"1000-…"`
    // sorts before `"999-…"` and loc ordering inverts past a thousand
    // messages, which is exactly the length at which paging matters.
    expect(client.request).toHaveBeenCalledWith(NODES_BY_LOC_PREFIX_QUERY, {
      memoryId: 'mem-1',
      locPrefix: 'chats:team:messages:',
      limit: Math.ceil(CHAT_PAGE_SIZE * 1.5),
      offset: 0,
      sort: 'seq',
    });
  });

  it('returns the NEWEST window, not the oldest, on a thread past one page', async () => {
    // The whole point of taking a total: the server pages from the front, so
    // "the newest N" is an offset near the end. Getting this backwards is the
    // defect @Dara fixed server-side in hadron-server#1111 — a reader landing
    // on the beginning of a long transcript.
    const client = {
      request: vi.fn().mockResolvedValue({ findNodes: { total: 500, hits: [] } }),
    } as any;
    await loadChatMessages(client, 'mem-1', 'chats:team');

    const second = client.request.mock.calls[1][1];
    expect(second.offset).toBe(500 - Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(second.offset).toBeGreaterThan(0);
  });

  it('reports hasOlder from the SERVER offset, not from how many survived filtering', async () => {
    // A page whose extras were all filtered out is SHORT, not final. Deriving
    // "no more" from the message count is how an infinite scroll stops early on
    // a thread with plenty left.
    const client = {
      request: vi.fn().mockResolvedValue({ findNodes: { total: 500, hits: [] } }),
    } as any;
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');
    expect(page.messages).toHaveLength(0);
    expect(page.hasOlder).toBe(true);
  });

  it('walks backwards from a previous window via `before`, in ONE request', async () => {
    // #793 (@copilot on PR #797). The old shape always probed at offset 0 first
    // — fetching the OLDEST page and discarding it — so every scroll-up cost
    // two round trips and one was guaranteed waste. With `before` the window is
    // already known, so the count comes back with the page we actually want.
    const client = {
      request: vi.fn().mockResolvedValue({ findNodes: { total: 500, hits: [] } }),
    } as any;
    await loadChatMessages(client, 'mem-1', 'chats:team', { before: 200 });

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request.mock.calls[0][1].offset).toBe(200 - Math.ceil(CHAT_PAGE_SIZE * 1.5));
  });

  it('has no older page once the window reaches the start', async () => {
    const client = {
      request: vi.fn().mockResolvedValue({ findNodes: { total: 10, hits: [] } }),
    } as any;
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');
    expect(page.offset).toBe(0);
    expect(page.hasOlder).toBe(false);
  });

  it('keeps only direct message children in provider seq order', async () => {
    const client = clientReturning([
      // Provider returns seq ASC; the client retains its window order.
      msg('chats:team:messages:001-y-holger', { seq: 1 }),
      msg('chats:team:messages:002-x-iris', { seq: 2 }),
      // Off-road content under the prefix (D-2026-08-10-003) — not a message.
      msg('chats:team:messages:notes', { nodeType: 'record', seq: 3 }),
      // Nested under a message (e.g. an attachment).
      msg('chats:team:messages:001-y-holger:attachment', { seq: 4 }),
      // A sibling chat whose loc merely starts with the same characters.
      msg('chats:team-notes:messages:x', { seq: 5 }),
    ]);

    const { messages } = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(messages.map((m) => m.nodeData.loc)).toEqual([
      'chats:team:messages:001-y-holger',
      'chats:team:messages:002-x-iris',
    ]);
  });

  it('orders a legacy thread by LOC — the key the server paged by', async () => {
    // #793 (@copilot on PR #797). This used to sort by `createdAt`, which was
    // fine while the window was the whole thread: the client's order is what
    // renders. Once PAGED it is not, because the trim takes "the last N" of the
    // CLIENT order while the cursor describes a position in the SERVER order.
    // Two orders over one window means the next page skips or repeats.
    //
    // The fixture makes them DISAGREE on purpose — loc `a` is older by name,
    // newer by timestamp — so the assertion can only pass on the loc order.
    const client = clientReturning([
      // Provider returns loc ASC, deliberately opposite to createdAt.
      msg('chats:team:messages:a', { nodeType: 'message', createdAt: '2026-08-14T12:00:00Z' }),
      msg('chats:team:messages:b', { nodeType: 'message', createdAt: '2026-08-14T09:00:00Z' }),
    ]);

    const { messages } = await loadChatMessages(client, 'mem-1', 'chats:team', { sort: 'loc' });

    expect(messages.map((m) => m.nodeData.loc)).toEqual([
      'chats:team:messages:a',
      'chats:team:messages:b',
    ]);
  });

  // #1581. The plain findNodes browse returns `total: null` (the count flag is
  // an internal object-store argument, not a public one), so the tail must be
  // located without a count. A mockResolvedValue client cannot answer a probe
  // at offset 150 faithfully — these tests need a client that windows by
  // offset+limit exactly like the server.
  function windowingClient(nodes: MemoryNode[], total: number | null = null) {
    const calls: { offset: number; limit: number }[] = [];
    const client = {
      request: vi.fn(async (_query: unknown, vars: { offset?: number; limit?: number }) => {
        const offset = Math.max(0, vars.offset ?? 0);
        const readCount = vars.limit ?? 0;
        calls.push({ offset, limit: readCount });
        return {
          findNodes: {
            total,
            hits: nodes.slice(offset, offset + readCount).map((node) => ({ node })),
          },
        };
      }),
    } as any;
    return { client, calls };
  }

  function platformThread(count: number): MemoryNode[] {
    return Array.from({ length: count }, (_, i) => {
      const n = i + 1;
      return msg(`chats:team:messages:${String(n).padStart(3, '0')}-x`, { seq: n });
    });
  }

  it('#1581: locates the NEWEST window when the browse total is null (271-node thread)', async () => {
    // The issue's exact fixture: 271 message nodes, `total: null`. On main the
    // null collapses to hits.length (150), the first page is taken for the
    // whole thread, and the reader gets the OLDEST 100 — the tail-correction
    // request is never even sent.
    const { client, calls } = windowingClient(platformThread(271), null);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages).toHaveLength(CHAT_PAGE_SIZE);
    expect(page.messages[0].seq).toBe(172);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(271);
    expect(page.total).toBe(271);
    expect(page.hasOlder).toBe(true);
    expect(page.offset).toBe(171);
    // Bounded: the optimistic read, at most a few locating reads, the window.
    // No request may exceed the fetch count — no drain.
    expect(calls.length).toBeLessThanOrEqual(6);
    for (const c of calls) {
      expect(c.limit).toBeLessThanOrEqual(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    }
  });

  it('#1581: a thread that fits one page makes no locating read when total is null', async () => {
    // 120 nodes fit inside the 150-node fetch, so the null total's collapse and
    // the located end AGREE — one request, exactly today's rendering (trimmed
    // to the page size, cursor at the first shown message).
    const { client, calls } = windowingClient(platformThread(120), null);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages).toHaveLength(CHAT_PAGE_SIZE);
    expect(page.messages[0].seq).toBe(21);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(120);
    expect(page.total).toBe(120);
    expect(page.hasOlder).toBe(true);
    expect(page.offset).toBe(20);
    expect(calls).toHaveLength(1);
  });

  it('#1581: an exact page-multiple thread (the empty-probe branch) still finds the true end', async () => {
    // 300 nodes: the gallop reads two full pages and then an EMPTY page at
    // offset 300 — the end is a page boundary, the case a short read can never
    // produce.
    const { client } = windowingClient(platformThread(300), null);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages[0].seq).toBe(201);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(300);
    expect(page.total).toBe(300);
  });

  it('#1581: an end inside a doubling gap is found with single-node probes, never a drain', async () => {
    // 450 nodes: full pages at 0/150/300, an empty read at 600 brackets the end
    // into (449, 600], and single-node reads narrow it — logarithmically, with
    // every request bounded by the page size.
    const { client, calls } = windowingClient(platformThread(450), null);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages[0].seq).toBe(351);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(450);
    expect(page.total).toBe(450);
    expect(calls.length).toBeLessThanOrEqual(14);
    for (const c of calls) {
      expect(c.limit).toBeLessThanOrEqual(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    }
  });

  it('#1581: a numeric total keeps today\'s two-request tail correction, same window', async () => {
    const { client, calls } = windowingClient(platformThread(271), 271);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages[0].seq).toBe(172);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(271);
    expect(page.total).toBe(271);
    expect(calls).toHaveLength(2);
  });

  it('#1581: `before` keeps its one-request window when total is null', async () => {
    const { client, calls } = windowingClient(platformThread(271), null);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team', { before: 200 });

    expect(calls).toHaveLength(1);
    expect(calls[0].offset).toBe(200 - Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(page.messages[0].seq).toBe(101);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(200);
  });

  it('reads the platform envelope (content + data.authorName) and the legacy one', async () => {
    const client = clientReturning([
      msg('chats:team:messages:001-x-iris', {
        seq: 1, name: '001-Iris', content: 'from content', data: { authorName: 'Iris' } as never,
      }),
      msg('chats:team:messages:002-x-h', {
        seq: 2, nodeType: 'message', data: { body: 'from data', author: 'holger' } as never,
      }),
    ]);

    const { messages } = await loadChatMessages(client, 'mem-1', 'chats:team');

    // The seq-prefixed node name ("001-Iris") is the last-resort author label;
    // the envelope's authorName wins.
    expect(messages[0]).toMatchObject({ content: 'from content', author: 'Iris', seq: 1 });
    expect(messages[1]).toMatchObject({ content: 'from data', author: 'holger', seq: 2 });
  });
});

describe('chatAuthorName', () => {
  it('prefers handle, then githubUsername, then name, then the email local part', () => {
    expect(chatAuthorName({ handle: 'h', githubUsername: 'gh', name: 'N', email: 'e@x.com' })).toBe('h');
    expect(chatAuthorName({ githubUsername: 'gh', email: 'e@x.com' })).toBe('gh');
    expect(chatAuthorName({ name: 'N', email: 'e@x.com' })).toBe('N');
    expect(chatAuthorName({ email: 'e@x.com' })).toBe('e');
    expect(chatAuthorName({})).toBe('anon');
  });
});

describe('locSafeAuthor', () => {
  it('squashes loc separators so a message cannot land a level deeper', () => {
    // A `:` would make loadChatMessages read the message as nested and drop it.
    expect(locSafeAuthor('Jane: Ops')).toBe('Jane-Ops');
    expect(locSafeAuthor('hrn:node:acme.com:m:x')).toBe('hrn-node-acme.com-m-x');
    expect(locSafeAuthor('a/b c')).toBe('a-b-c');
  });

  it('leaves an already-safe handle alone and never yields an empty segment', () => {
    expect(locSafeAuthor('holger')).toBe('holger');
    expect(locSafeAuthor('holger.s_1-x')).toBe('holger.s_1-x');
    expect(locSafeAuthor(':::')).toBe('anon');
  });
});

describe('chatPostTarget', () => {
  const teamChat = {
    nodeType: 'chat', loc: 'chats:team', tags: [], memory: { appId: 'app-1' },
  } as unknown as MemoryNode;

  it('routes the App-s well-known team chat through the platform operation', () => {
    expect(chatPostTarget(teamChat)).toEqual({ kind: 'platform', appId: 'app-1' });
  });

  it('refuses to route ANOTHER chat node through it, even in an App memory', () => {
    // createTeamChatMessage takes an appRef, not a chat address — it would post
    // to `chats:team`, so a success here would land the message elsewhere.
    expect(chatPostTarget({ ...teamChat, loc: 'chats:design-review' } as MemoryNode)).toEqual({ kind: 'none' });
  });

  it('keeps a legacy tagged thread on the node path even when its memory has an App', () => {
    const tagged = {
      nodeType: 'info', loc: 'chats:standup', tags: ['team-chat'], memory: { appId: 'app-1' },
    } as unknown as MemoryNode;
    expect(chatPostTarget(tagged, { legacyThread: true })).toEqual({ kind: 'legacy' });
    // #926: without thread evidence the tag is a topic, and there is nowhere to post.
    expect(chatPostTarget(tagged)).toEqual({ kind: 'none' });
  });

  it('has nowhere to post for a platform chat whose memory has no App', () => {
    expect(chatPostTarget({ ...teamChat, memory: { appId: null } } as MemoryNode)).toEqual({ kind: 'none' });
  });

  it('has nowhere to post for a node that is not a chat at all', () => {
    expect(chatPostTarget({ nodeType: 'info', loc: 'notes:x', tags: [] } as unknown as MemoryNode))
      .toEqual({ kind: 'none' });
  });
});

describe('postChatMessage', () => {
  it('posts a platform chat through createTeamChatMessage, never a node write', async () => {
    const client = { request: vi.fn().mockResolvedValue({ createTeamChatMessage: { nodeId: 'm-1', seq: 4 } }) } as any;

    const posted = await postChatMessage(client, {
      target: { kind: 'platform', appId: 'app-1' },
      memoryId: 'mem-1', chatLoc: 'chats:team',
      author: 'holger', content: 'hello team',
    });

    expect(posted).toEqual({ nodeId: 'm-1' });
    expect(client.request).toHaveBeenCalledTimes(1);
    expect(client.request).toHaveBeenCalledWith(CREATE_TEAM_CHAT_MESSAGE_MUTATION, {
      appRef: 'app-1', body: 'hello team',
    });
  });

  it('refuses to write when the target says there is nowhere to post', async () => {
    const client = { request: vi.fn() } as any;

    await expect(postChatMessage(client, {
      target: { kind: 'none' }, memoryId: 'mem-1', chatLoc: 'chats:team',
      author: 'holger', content: 'hi',
    })).rejects.toThrow(/no post target/);
    expect(client.request).not.toHaveBeenCalled();
  });

  it('writes a node for a legacy chat', async () => {
    const client = { request: vi.fn().mockResolvedValue({ createNode: { id: 'm-1' } }) } as any;

    const posted = await postChatMessage(client, {
      target: { kind: 'legacy' },
      memoryId: 'mem-1',
      chatLoc: 'chats:team',
      author: 'holger',
      content: 'hello team',
      now: new Date('2026-08-14T12:34:56.789Z'),
    });

    expect(posted).toEqual({ nodeId: 'm-1' });
    expect(client.request).toHaveBeenCalledWith(CREATE_NODE_MUTATION, {
      input: {
        memoryId: 'mem-1',
        loc: 'chats:team:messages:2026-08-14T123456789-holger',
        name: 'holger',
        nodeType: 'message',
        data: { body: 'hello team', author: 'holger' },
      },
    });
  });

  it('keeps a `:`-carrying author out of the legacy loc but verbatim in the payload', async () => {
    const client = { request: vi.fn().mockResolvedValue({ createNode: { id: 'm-1' } }) } as any;

    await postChatMessage(client, {
      target: { kind: 'legacy' },
      memoryId: 'mem-1',
      chatLoc: 'chats:team',
      author: 'Jane: Ops',
      content: 'hi',
      now: new Date('2026-08-14T12:34:56.789Z'),
    });

    expect(client.request).toHaveBeenCalledWith(CREATE_NODE_MUTATION, {
      input: expect.objectContaining({
        loc: 'chats:team:messages:2026-08-14T123456789-Jane-Ops',
        name: 'Jane: Ops',
        data: { body: 'hi', author: 'Jane: Ops' },
      }),
    });
  });
});

// #793. The paging key differs by chat generation, and getting it wrong is
// silent: a legacy chat sorted by `seq` orders on a field every row leaves
// null, which is harmless while the thread fits one page (the client re-sorts)
// and wrong the moment it is PAGED, because the window is a slice of an
// arbitrary order.
describe('chatSortKey', () => {
  it('uses seq for a platform chat', () => {
    expect(chatSortKey({ nodeType: 'chat' } as MemoryNode)).toBe('seq');
  });

  it('uses loc for a legacy chat, whose messages have no seq at all', () => {
    // The legacy root is an ordinary node carrying the `team-chat` tag; its
    // message locs are ISO timestamps, so loc is chronological.
    expect(chatSortKey({ nodeType: 'info' } as MemoryNode)).toBe('loc');
  });

  it('never returns loc for a platform chat — loc inverts past 999', () => {
    // The server pads the seq atom to three digits, so "1000-…" < "999-…".
    // Loc ordering silently reverses at exactly the length where paging starts
    // to matter, which is why this is a per-generation choice and not a default.
    expect(chatSortKey({ nodeType: 'chat' } as MemoryNode)).not.toBe('loc');
  });
});

// #793. Found by driving a real 142-message thread: the node over-fetch (1.5x,
// to absorb non-message children) silently became the window, so the constant
// said 100 and the reader got 142 with no scroll-up affordance.
describe('loadChatMessages — the window is the PAGE SIZE, not the over-fetch', () => {
  function manyMessages(n: number) {
    return Array.from({ length: n }, (_, i) =>
      msg(`chats:team:messages:${String(i + 1).padStart(3, '0')}-x`, { seq: i + 1 }),
    );
  }

  it('trims a thread between the page size and the over-fetch, and offers older', async () => {
    const hits = manyMessages(142);
    const client = {
      request: vi.fn().mockResolvedValue({
        findNodes: { total: 142, hits: hits.map((node) => ({ node })) },
      }),
    } as any;
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages).toHaveLength(CHAT_PAGE_SIZE);
    // The NEWEST page, not the oldest — seq 43..142 for a 142-message thread.
    expect(page.messages[page.messages.length - 1].seq).toBe(142);
    // And it must say there is more, or the reader is stranded on a window that
    // looks like the whole thread.
    expect(page.hasOlder).toBe(true);
  });

  it('does not claim older content when the whole thread fits the page', async () => {
    const hits = manyMessages(10);
    const client = {
      request: vi.fn().mockResolvedValue({
        findNodes: { total: 10, hits: hits.map((node) => ({ node })) },
      }),
    } as any;
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');
    expect(page.messages).toHaveLength(10);
    expect(page.hasOlder).toBe(false);
  });
});

// #793. The cursor must be the node index of the FIRST SHOWN message, not the
// fetch offset. Found by driving: on a 142-message thread the fetch offset was
// 0 while 42 messages sat before the window, so the scroll-up asked for
// `before=0`, the endpoint rejected it as a bad cursor, and the reader got one
// request and zero rows — forever.
describe('loadChatMessages — the cursor is absolute, not the fetch offset', () => {
  it('points at the first shown message when the trim left older content behind', async () => {
    const hits = Array.from({ length: 142 }, (_, i) =>
      msg(`chats:team:messages:${String(i + 1).padStart(3, '0')}-x`, { seq: i + 1 }),
    );
    const client = {
      request: vi.fn().mockResolvedValue({
        findNodes: { total: 142, hits: hits.map((node) => ({ node })) },
      }),
    } as any;
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    // 142 fetched, 100 shown → the first shown one sits at node index 42, and
    // that is the cursor the next page must ask to come BEFORE.
    expect(page.offset).toBe(42);
    expect(page.hasOlder).toBe(true);
    // The bug: returning the fetch offset here would be 0, which the endpoint
    // refuses, so the scroll-up would spin without ever loading a page.
    expect(page.offset).not.toBe(0);
  });
});

// #793. Found by driving, not by review: `before=42` on a 142-message thread
// returned 100 messages — the newest page, the one the reader already had —
// because `firstOffset` clamps to 0 when `before` is smaller than the
// over-fetch, so the response holds far more than the window asked for.
describe('loadChatMessages — a short `before` window is bounded, not the whole head', () => {
  const hits = Array.from({ length: 142 }, (_, i) =>
    msg(`chats:team:messages:${String(i + 1).padStart(3, '0')}-x`, { seq: i + 1 }),
  );
  const client = () =>
    ({
      request: vi.fn().mockResolvedValue({
        findNodes: { total: 142, hits: hits.map((node) => ({ node })) },
      }),
    }) as any;

  it('returns only what precedes the cursor', async () => {
    const page = await loadChatMessages(client(), 'mem-1', 'chats:team', { before: 42 });
    expect(page.messages).toHaveLength(42);
    // The OLDEST 42 — seq 1..42 — not the newest 100.
    expect(page.messages[0].seq).toBe(1);
    expect(page.messages[page.messages.length - 1].seq).toBe(42);
  });

  it('reaches the start of the thread and says so', async () => {
    // The bug also made this `true`, so the scroll-up would have asked forever
    // for a page it already had.
    const page = await loadChatMessages(client(), 'mem-1', 'chats:team', { before: 42 });
    expect(page.offset).toBe(0);
    expect(page.hasOlder).toBe(false);
  });
});
