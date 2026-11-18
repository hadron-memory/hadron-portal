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
  function windowingClient(
    nodes: MemoryNode[],
    total: number | null = null,
    opts: {
      clampFrom?: number;
      failFrom?: number;
      /** Fail the FIRST call with offset ≥ this once (a transient blip), then serve normally. */
      failOnceFrom?: number;
      /** Fail exactly these 1-based call numbers (any offset), serve the rest normally. */
      failCalls?: number[];
      omitTotal?: boolean;
      /** Answer single-node reads at offset ≥ this with the LAST node instead of empty. */
      clampSinglesFrom?: number;
      /** Splice `node` into the list at `index` before serving 1-based call `call`. */
      insertBeforeCall?: { call: number; index: number; node: MemoryNode };
      /** Truncate the list to `to` nodes before serving 1-based call `call` (legal deletes). */
      shrinkToBeforeCall?: { call: number; to: number };
      /** Report a numeric count (instead of null) from 1-based call `from` on. A
       * bare number reports the list's CURRENT length (a warmed, accurate
       * cache); `{ from, value }` reports `value` — a lagging or leading cache,
       * one a locate could not produce. */
      totalFromCall?: number | { from: number; value: number };
    } = {},
  ) {
    const calls: { offset: number; limit: number }[] = [];
    let blipped = false;
    const client = {
      request: vi.fn(async (_query: unknown, vars: { offset?: number; limit?: number }) => {
        const offset = Math.max(0, vars.offset ?? 0);
        const readCount = vars.limit ?? 0;
        if (opts.insertBeforeCall && calls.length + 1 === opts.insertBeforeCall.call) {
          nodes.splice(opts.insertBeforeCall.index, 0, opts.insertBeforeCall.node);
        }
        if (opts.shrinkToBeforeCall && calls.length + 1 === opts.shrinkToBeforeCall.call) {
          nodes.splice(opts.shrinkToBeforeCall.to);
        }
        calls.push({ offset, limit: readCount });
        if (opts.failCalls?.includes(calls.length)) {
          // A per-call injection, distinguishable from the offset-keyed
          // failures below: the P3-a leg asserts on these messages.
          throw new Error(`injected failure on call ${calls.length} at offset ${offset}`);
        }
        if (
          opts.failOnceFrom !== undefined &&
          offset >= opts.failOnceFrom &&
          !blipped
        ) {
          blipped = true;
          throw new Error('probe failed: transient blip');
        }
        if (opts.failFrom !== undefined && offset >= opts.failFrom) {
          // A generic transport failure at an offset — NOT a modeled offset
          // cap (the server imposes none; the locator's cap is client-side).
          // The message this fixture throws is what the failed-probe test's
          // /probe failed/ regex matches — change one, change the other.
          throw new Error(`probe failed at ${offset}`);
        }
        const hits =
          opts.clampFrom !== undefined && offset >= opts.clampFrom
            ? // A clamping server answers this offset with the LAST page, full.
              nodes.slice(Math.max(0, nodes.length - readCount))
            : opts.clampSinglesFrom !== undefined &&
                readCount === 1 &&
                offset >= opts.clampSinglesFrom
              ? // ...and one that clamps only single-node reads answers with
                // the last NODE rather than the truthful empty page.
                nodes.slice(nodes.length - 1)
              : nodes.slice(offset, offset + readCount);
        const totalFrom =
          opts.totalFromCall === undefined
            ? undefined
            : typeof opts.totalFromCall === 'number'
              ? calls.length >= opts.totalFromCall
                ? nodes.length
                : null
              : calls.length >= opts.totalFromCall.from
                ? opts.totalFromCall.value
                : null;
        return {
          // omitTotal: a resolver that drops the count field entirely —
          // `total` is ABSENT (undefined), which is not `null`.
          findNodes: {
            ...(opts.omitTotal ? {} : { total: totalFrom ?? total }),
            hits: hits.map((node) => ({ node })),
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
    // Two requests: the optimistic read, then the one short locating read —
    // whose hits already hold [150, 271), so the fetched window [121, 271) —
    // the 1.5× over-fetch; its newest CHAT_PAGE_SIZE ([171, 271), the asserted
    // seqs) is what gets served after the trim — is assembled from the two
    // reads instead of fetched again. No request may exceed the
    // fetch count — no drain.
    expect(calls).toHaveLength(2);
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
    // produce. Three requests total: the first page, the full probe at 150,
    // the empty probe at 300; the window [150, 300) is assembled from the
    // recorded reads.
    const { client, calls } = windowingClient(platformThread(300), null);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages[0].seq).toBe(201);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(300);
    expect(page.total).toBe(300);
    expect(calls).toHaveLength(3);
  });

  it('#1581: an end inside a doubling gap is found with single-node probes, never a drain', async () => {
    // 450 nodes: full pages at 0/150/300, an empty read at 600 brackets the end
    // into (449, 600], and single-node reads narrow it — logarithmically, with
    // every request bounded by the page size. The window [300, 450) is
    // assembled from the recorded full pages, so no window fetch is added.
    const { client, calls } = windowingClient(platformThread(450), null);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages[0].seq).toBe(351);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(450);
    expect(page.total).toBe(450);
    expect(calls.length).toBeLessThanOrEqual(12);
    for (const c of calls) {
      expect(c.limit).toBeLessThanOrEqual(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    }
  });

  it('#1581: a thread of exactly one fetch page locates its end with one probe', async () => {
    // 150 nodes = exactly fetchCount: the first read comes back FULL, so the
    // short-read shortcut cannot apply — one empty probe at 150 brackets the
    // end exactly, and the window is the reused first read.
    const { client, calls } = windowingClient(platformThread(150), null);
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.total).toBe(150);
    expect(page.messages[0].seq).toBe(51);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(150);
    expect(page.hasOlder).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('#1581: an ABSENT total field (undefined, not null) locates like a null one', async () => {
    // A resolver may drop `total` from the response entirely; undefined is
    // not null, and a `!== null` test once turned it into NaN offsets. The
    // numeric path is for real numbers only.
    const { client, calls } = windowingClient(platformThread(271), null, { omitTotal: true });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.messages[0].seq).toBe(172);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(271);
    expect(page.total).toBe(271);
    expect(calls).toHaveLength(2);
  });

  it('#1581/#1820: a failed locating probe rejects the load — retried once, never a silent false tail', async () => {
    // The degradation this PR must not ship: one transient failure on the
    // probe at 150 of a 271-node thread, read as "empty", understates the
    // thread as 150 nodes and serves the OLDEST page with no scroll-up —
    // the original defect, silently. A locating failure rejects instead,
    // exactly as a failed tail-correction request always did (the issue's
    // failed-read hold). One retry (N5) absorbs a single blip; a server
    // that keeps failing is still rejected, one attempt later.
    const { client, calls } = windowingClient(platformThread(271), null, { failFrom: 150 });
    const failure = loadChatMessages(client, 'mem-1', 'chats:team');
    await expect(failure).rejects.toThrow(/probe failed/);
    // The rejection is the RETRY's error with the attempt-1 error chained as
    // `cause` (#1820 review): the root cause survives the absorbed attempt.
    await expect(failure).rejects.toMatchObject({
      cause: { message: 'probe failed at 150' },
    });

    // Attempt 1: the first read, then the failed probe at 150. Attempt 2
    // restarts from a FRESH first read (offset 0), then its probe at 150
    // fails again — the one-retry bound: a server that keeps failing is
    // rejected one fresh page later, never rescued.
    expect(calls).toHaveLength(4);
    // The count-pinned arithmetic below assumes the first read asked for the
    // full over-fetch — pin the premise so a page-size change fails here,
    // with a clear message, rather than as a bare count mismatch.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
  });

  it('#1820 (N5): one transient probe failure is absorbed by the retry', async () => {
    // The same 271-node thread, but the failure is a ONE-SHOT blip: the first
    // probe at 150 throws, the retry restarts from a fresh first read, and
    // the load completes at the true end. A single transport hiccup no
    // longer blanks the chat.
    const { client, calls } = windowingClient(platformThread(271), null, { failOnceFrom: 150 });
    // The retry is observable, not silent (#1820 review): one warn, naming
    // the thread prefix and the absorbed error. Observed — and silenced —
    // through a globalThis.console proxy: in the node lane vitest wraps
    // console before the module evaluates, so `vi.spyOn(console, 'warn')`
    // never sees the module's call (the module reaches the warn through
    // globalThis.console, which the proxy DOES intercept — verified by
    // probing the property access).
    const warns: unknown[][] = [];
    vi.stubGlobal(
      'console',
      new Proxy(console, {
        get(target, prop) {
          if (prop === 'warn') {
            return (...args: unknown[]) => {
              warns.push(args);
            };
          }
          return Reflect.get(target, prop);
        },
      }),
    );
    let page: Awaited<ReturnType<typeof loadChatMessages>>;
    try {
      page = await loadChatMessages(client, 'mem-1', 'chats:team');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(warns).toHaveLength(1);
    expect(String(warns[0][0])).toContain('chats:team');
    expect(String(warns[0][0])).toContain('probe failed: transient blip');

    expect(page.total).toBe(271);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(271);
    // Attempt 1: first read, then the blip at 150. Attempt 2: the FRESH
    // first read (full), then its probe at 150 — 121 rows, SHORT, itself the
    // exact end (no bisection). The fresh page [0,150) and the short probe
    // [150,271) together cover the window [121,271), so it is ASSEMBLED from
    // those two records: no window fetch. Four requests.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(4);
  });

  it('#1820: a FAILED fresh first read rejects with its own error, the first chained as `cause`', async () => {
    // The fresh read sits INSIDE the retry's cause-chaining try: when the
    // re-issued first page itself fails, the rejection is the FRESH error
    // with the attempt-1 error as `cause` — the retry note's promise. An
    // earlier head awaited the fresh read before that try, so its failure
    // escaped with the first error silently lost (#1820 review).
    const { client, calls } = windowingClient(platformThread(271), null, {
      failCalls: [2, 3],
    });
    const failure = loadChatMessages(client, 'mem-1', 'chats:team');
    await expect(failure).rejects.toThrow(/injected failure on call 3/);
    await expect(failure).rejects.toMatchObject({
      cause: { message: 'injected failure on call 2 at offset 150' },
    });
    // Call 1: the first read. Call 2: the probe at 150 fails. Call 3: the
    // FRESH first read fails — the retry is spent, nothing else is asked.
    expect(calls).toHaveLength(3);
  });

  it('#1581/#1820: a clamping server (a full page for ANY offset) is rejected — the retry cannot rescue it', async () => {
    // Offset clamping answers every offset with the same fixed full page, so
    // the FIRST probe repeats the first read's ids. The retry restarts from a
    // fresh first read — which the clamp answers with the same fixed page —
    // so the retry's own first probe repeats it too: the liar is named on
    // attempt 2's FIRST probe, never rescued.
    const { client, calls } = windowingClient(platformThread(600), null, { clampFrom: 0 });
    const rejection = loadChatMessages(client, 'mem-1', 'chats:team');
    await expect(rejection).rejects.toThrow(/overlapping page/);
    // The rejection carries the class name (not a bare `Error`) and the
    // attempt-1 repeat as `cause` (#1820 review).
    await expect(rejection).rejects.toMatchObject({
      name: 'OverlappingPageError',
      cause: { name: 'OverlappingPageError' },
    });

    // attempt 1: the first read (itself the fixed page), then the repeating
    // probe at 150. attempt 2: the fresh first read (the fixed page again),
    // then the probe at 150 (the repeat that names the server).
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(4);
  });

  it('#1581/#1820: a server that clamps only OUT-OF-RANGE offsets is named on the repeat', async () => {
    // The subtler liar (#1820 review): in-range offsets are answered
    // truthfully, only offsets past the end get the fixed last page. The first
    // out-of-range probe returns that page fresh, so a first-read-only id
    // check cannot see it — but the SECOND out-of-range probe repeats it, and
    // the detector tracks every id every locating read has returned, not just
    // the first read's. The retry's fresh seed sees the lie fresh too, and
    // its own second out-of-range probe repeats it again.
    const { client, calls } = windowingClient(platformThread(600), null, { clampFrom: 600 });
    await expect(loadChatMessages(client, 'mem-1', 'chats:team')).rejects.toThrow(/overlapping page/);

    // Attempt 1: first read, then probes at 150, 300 (truthful), 600 (the
    // lie, fresh), 1200 (the lie again — the repeat that names it). Attempt
    // 2: the fresh first read, then probes at 150, 300 (truthful), 600 (the
    // lie, fresh to the fresh seed), 1200 (the repeat).
    // The count is gallop arithmetic on the over-fetch; pin the premise so a
    // page-size change fails here, not as a bare count mismatch.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(10);
  });

  it('#1820: a mid-locate insert below the read frontier retries once and succeeds', async () => {
    // #1820 review: the honest repeat. On a root no live
    // Channel protects, restoreNode and cloneNode can insert a node below the
    // tail WHILE the locate runs. The insert shifts every later row down one
    // offset, so the probe at the read frontier returns the previous window's
    // last row again — a repeat that is not a lying server. The locator
    // retries once from a FRESH first read against the shifted list and the
    // load completes at the then-current end. Here a restore lands at index
    // 5 — below the first window [0,150) — just before the second probe;
    // restoreNode keeps the row's old seq (5, loc-tied with the row already
    // there — the realistic race, not a fabricated -1).
    const inserted = msg('chats:team:messages:005-restored', { seq: 5 });
    const { client, calls } = windowingClient(platformThread(610), null, {
      insertBeforeCall: { call: 3, index: 5, node: inserted },
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    // The retry located the SHIFTED list exactly: 611 nodes, newest window.
    expect(page.total).toBe(611);
    expect(page.messages).toHaveLength(CHAT_PAGE_SIZE);
    expect(page.messages[0].seq).toBe(511);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(610);
    expect(page.hasOlder).toBe(true);
    // Attempt 1: first read, probe 150 (full), probe 300 → old row 299 again
    // (the honest repeat). Attempt 2: the FRESH first read (the shifted
    // [0,150)), probes 150, 300 (full, disjoint on the shifted list), 600
    // (11 rows — short, the exact end). The gallop skipped [450,600), so the
    // fetched window [461,611) — the 1.5× over-fetch, whose newest
    // CHAT_PAGE_SIZE is served after the trim — is NOT covered by the
    // records: one fresh window fetch. Eight requests.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(8);
    for (const c of calls) {
      expect(c.limit).toBeLessThanOrEqual(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    }
  });

  it('#1820: the retry re-records from the fresh first page — the window is assembled, never stitched across the shift', async () => {
    // The frontier-adjacent insert: a restore lands at index 5 just before
    // the first probe, which then repeats old row 149 honestly. The retry
    // re-reads offset 0 and re-records the segments from the FRESH page; the
    // fresh [0,150) plus the short probe [150,291) assemble the fetched
    // window [141,291) — the 1.5× over-fetch, trimmed to the newest
    // CHAT_PAGE_SIZE (seqs 191..291 of the shifted list) below — a gapless
    // shifted sequence, one request cheaper than the
    // old drop-and-refetch. (The mutant that would stitch a STALE segment
    // into an overlapping window — duplicating a row and losing the restored
    // one — needs the insert INSIDE the window; that geometry is pinned by
    // the fresh-first-page test below, which goes red with the re-record
    // deleted.)
    const inserted = msg('chats:team:messages:005-restored', { seq: 5 });
    const { client, calls } = windowingClient(platformThread(290), null, {
      insertBeforeCall: { call: 2, index: 5, node: inserted },
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.total).toBe(291);
    // The newest 100 of the shifted 291-node list: seqs 191..290, strictly
    // consecutive — a duplicated or dropped seam row breaks the run.
    expect(page.messages.map((m) => m.seq)).toEqual(
      Array.from({ length: CHAT_PAGE_SIZE }, (_, i) => 191 + i),
    );
    // Attempt 1: first read, probe 150 (old row 149 again — the honest
    // repeat, its page RECORDED before the rejection). Attempt 2: the fresh
    // first read, then probe 150 (141 rows, short — the exact end of the
    // shifted list). Four requests.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(4);
  });

  it('#1820: the retry restarts from a FRESH first page — a restored node inside the window appears exactly once', async () => {
    // #1820 review: the geometry that makes the retry's record-dropping
    // LOAD-BEARING. The insert lands INSIDE the final window and the window
    // OVERLAPS the first read. 200 nodes; before the probe at 150 a restore
    // inserts at index 120 — the probe repeats old row 149 HONESTLY, so the
    // retry runs. The retry re-reads offset 0 first (the fresh page [0,150))
    // and the short probe [150,201) then ASSEMBLES the fetched window
    // [51,201) — the 1.5× over-fetch, whose newest CHAT_PAGE_SIZE
    // ([101,201), the asserted seqs) is served after the trim. If
    // the retry kept any attempt-1 record — the stale pre-shift first page
    // or the rejected probe — assembledWindow would cover [51,150) with
    // pre-shift rows: the restored node MISSING from the window and old row
    // 149's twin at the seam. Delete the record reset and this goes red.
    const inserted = msg('chats:team:messages:121-restored', { seq: 121 });
    const { client, calls } = windowingClient(platformThread(200), null, {
      insertBeforeCall: { call: 2, index: 120, node: inserted },
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.total).toBe(201);
    // The newest 100 of the shifted list: old 102..120, the restored node
    // (seq 121, loc-tied with old 120 — restoreNode keeps its old seq), then
    // old 121..200. The restored node appears EXACTLY ONCE, and no id is
    // duplicated anywhere in the page.
    expect(page.messages.map((m) => m.seq)).toEqual([
      ...Array.from({ length: 19 }, (_, i) => 102 + i),
      121,
      ...Array.from({ length: 80 }, (_, i) => 121 + i),
    ]);
    expect(page.messages.filter((m) => m.id === inserted.id)).toHaveLength(1);
    expect(new Set(page.messages.map((m) => m.id)).size).toBe(CHAT_PAGE_SIZE);
    // Attempt 1: first read, the repeating probe at 150. Attempt 2: the
    // fresh first read, the short probe at 150 (51 rows — the exact end).
    // The window is ASSEMBLED from those two records: no fifth request.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(4);
    for (const c of calls) {
      expect(c.limit).toBeLessThanOrEqual(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    }
  });

  it('#1820: a mid-locate SHRINK races the retry — the fresh first page is the end, never the stale one (151→149)', async () => {
    // #1820 review: the shrink race, executed against the previous head.
    // 151 nodes,
    // and the probe at 150 both blips once AND races legal deletes that
    // leave 149. The retry re-issues the FIRST read from offset 0; the
    // fresh page comes back SHORT (149 < 150), so it is itself the end.
    // Keeping the attempt-1 snapshot would keep its stale lower bound (149)
    // and reuse the STALE first page — total 150 and old rows 50..149, the
    // #1581 false tail again, from the retry that was meant to prevent it.
    const { client, calls } = windowingClient(platformThread(151), null, {
      failOnceFrom: 150,
      shrinkToBeforeCall: { call: 2, to: 149 },
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.total).toBe(149);
    // The CURRENT list, newest 100: seqs 50..149. Every removed row is gone.
    expect(page.messages.map((m) => m.seq)).toEqual(
      Array.from({ length: CHAT_PAGE_SIZE }, (_, i) => 50 + i),
    );
    // Attempt 1: the stale full read, the blipping+shrinking probe. Attempt
    // 2: the fresh first read — short, the exact end; the window is its own
    // reuse. Three requests, none a drain.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(3);
  });

  it('#1820: a shrink far below one page (271→30) serves the current 30, never the stale 150', async () => {
    // The same race with the thread collapsed to a fraction of a page: the
    // stale snapshot would return total 150 with rows that no longer exist.
    // The fresh first page is 30 rows — short, the whole thread.
    const { client, calls } = windowingClient(platformThread(271), null, {
      failOnceFrom: 150,
      shrinkToBeforeCall: { call: 2, to: 30 },
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.total).toBe(30);
    expect(page.messages).toHaveLength(30);
    expect(page.messages.map((m) => m.seq)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    expect(calls).toHaveLength(3);
  });

  it('#1820: a shrink to an EMPTY thread (271→0) loads an empty page, not the stale one', async () => {
    // The boundary of the same race: everything deleted mid-locate. The
    // fresh first page is EMPTY — the thread has no tail to locate, and the
    // page says so. The stale snapshot would still hand back 150 ghosts.
    const { client, calls } = windowingClient(platformThread(271), null, {
      failOnceFrom: 150,
      shrinkToBeforeCall: { call: 2, to: 0 },
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.total).toBe(0);
    expect(page.messages).toEqual([]);
    expect(page.hasOlder).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it('#1820 documents: a shrink during the FIRST attempt, no blip, keeps the stale bound (accepted skew)', async () => {
    // The boundary the retry CANNOT cover, pinned so its limits are as
    // explicit as its guarantees. 151 nodes; legal deletes leave 149 before
    // the probe — but nothing FAILS, so no retry runs. The probe at 150
    // comes back honestly EMPTY, the bisection narrows against attempt 1's
    // stale lower bound (149), and the locate ends at 150: the first page —
    // read before the deletes — is served whole with a now-deleted row
    // (seq 150) and `total` 150, not the true 149. This is the locate's
    // PRE-EXISTING snapshot semantics — the branch-base main produced the
    // same wrong answer here by construction (its null-total collapse served
    // the first page as the whole thread for EVERY thread this long), so
    // #1820 neither introduced nor fixed this shape — unchanged by the
    // retry, which only fires on a
    // failure or repeat; the fresh-first-page shrink tests above are the
    // blip-raced halves of this same geometry, and THERE the fresh page is
    // the end. If attempt-1 staleness is ever fixed (e.g. re-proving the
    // bound after an empty probe), update this test to the stronger
    // guarantee — it exists to make that change visible, not to bless the
    // skew forever.
    const { client, calls } = windowingClient(platformThread(151), null, {
      shrinkToBeforeCall: { call: 2, to: 149 },
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    // The stale end: 150, not 149 — and the stale newest row, seq 150,
    // which no longer exists. Two requests: the first read, the empty
    // probe; the bisection gap is a single index and costs nothing.
    expect(page.total).toBe(150);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(150);
    expect(calls).toHaveLength(2);
  });

  it('#1820: a retry whose fresh first read now reports a COUNT is trusted — no second gallop', async () => {
    // The retry re-evaluates the total decision on the fresh snapshot, not
    // just the geometry: if the server reports a numeric count by the time
    // the fresh first read lands (the count cache warmed, the resolver
    // changed its mind), that count is used exactly as the primary path uses
    // the first read's — and the retry's gallop never runs. Without this the
    // locator would probe on after the server had already answered.
    const { client, calls } = windowingClient(platformThread(271), null, {
      failOnceFrom: 150,
      totalFromCall: 3,
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.total).toBe(271);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(271);
    // Attempt 1: the null-total first read, the blip at 150. Attempt 2: the
    // fresh first read — total 271, a number — is trusted, so the retry's
    // gallop never runs. The fetched window [121,271) (the 1.5× over-fetch;
    // the newest CHAT_PAGE_SIZE of it is served after the trim) reaches past
    // the fresh page [0,150), so one WINDOW FETCH closes it — call 4 at
    // offset 121, NOT a gallop probe at 150. That call shape is the pin:
    // with the trusted-count branch deleted the retry would gallop, and its
    // short probe at 150 would return the same total, the same last seq,
    // and still four calls — only calls[3] tells the two futures apart.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(4);
    expect(calls[3]).toEqual({ offset: 121, limit: Math.ceil(CHAT_PAGE_SIZE * 1.5) });
  });

  it('#1820: the trusted COUNT is the reported one — a lagging count beats the located end', async () => {
    // The trust pin's other half. A warmed count cache can lag the list: the
    // fresh first read reports 271 while the thread has grown to 300. The
    // primary path trusts the first read's reported count without
    // cross-checking it, and the retry's branch is exactly that trust — so
    // 271 is the answer, NOT the 300 a second gallop would locate. (Serving
    // follows the count: the window ends at 271 and misses the newest 29 —
    // the same skew the primary path buys with a lagging first read.)
    const { client, calls } = windowingClient(platformThread(300), null, {
      failOnceFrom: 150,
      totalFromCall: { from: 3, value: 271 },
    });
    const page = await loadChatMessages(client, 'mem-1', 'chats:team');

    expect(page.total).toBe(271);
    expect(page.messages[CHAT_PAGE_SIZE - 1].seq).toBe(271);
    // Four requests: first read, blip at 150, fresh read (the count), window
    // fetch [121,271) — the gallop never ran, or the located 300 would be
    // the total and the newest page would end at seq 300.
    expect(calls).toHaveLength(4);
    expect(calls[3]).toEqual({ offset: 121, limit: Math.ceil(CHAT_PAGE_SIZE * 1.5) });
  });

  it('#1820: a clamp whose fixed page OVERLAPS the last truthful page repeats on its first lie', async () => {
    // The unaligned-length variant (#1820 review): 500 nodes is not a
    // page multiple, so the clamped last page [350,500) overlaps the truthful
    // page [300,450) the probe at 300 already read — the repeat arrives on
    // the clamp's FIRST answer, not its second. Both attempts see it (the
    // retry's probe at 300 re-reads the overlapping region against its fresh
    // seed), so the liar is named without ever galloping to the offset cap.
    const { client, calls } = windowingClient(platformThread(500), null, { clampFrom: 500 });
    await expect(loadChatMessages(client, 'mem-1', 'chats:team')).rejects.toThrow(/overlapping page/);

    // Attempt 1: first read, 150, 300 (truthful), 600 (the lie, overlapping).
    // Attempt 2: the fresh first read, 150, 300 (truthful), 600 (the lie —
    // the repeat).
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(8);
  });

  it('#1820: a repeat on a BISECTION read is named — single-node probes check ids too', async () => {
    // The repeat detector guards the binary-search single-node reads, not
    // just the gallop's pages: a server that clamps only single-node reads
    // (here, from offset 500) answers the narrowing mid reads with the LAST
    // node instead of the truthful empty. The mid lands past the clamp, the
    // "existing" node is one the probe at 300 already read — a repeat on the
    // bisection path. The retry re-runs the same arithmetic against the same
    // liar and repeats again; named, not rescued.
    const { client, calls } = windowingClient(platformThread(450), null, { clampSinglesFrom: 500 });
    await expect(loadChatMessages(client, 'mem-1', 'chats:team')).rejects.toThrow(/overlapping page/);

    // Attempt 1: first read, 150, 300 (full), 600 (truthfully EMPTY — a page
    // read, not clamped), then the bisection mid 524 (the lie, a repeat).
    // Attempt 2: the fresh first read, then 150, 300, 600, 524 (the repeat).
    // The count below is gallop arithmetic on the over-fetch; pin the premise
    // so a page-size change fails here, not as a bare count mismatch.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(10);
  });

  it('#1581: a server that never runs short is cut off at the offset cap and rejected', async () => {
    // Fresh full pages forever (a server fabricating nodes, so the overlap
    // detector cannot name it): the gallop stops at 2^30 — no thread holds a
    // billion nodes, and the cap sits below the GraphQL Int boundary (2^31-1)
    // so the NAMED rejection fires before variable coercion fails — and
    // rejects rather than serving a fabricated end.
    const calls: { offset: number; limit: number }[] = [];
    const growing = {
      request: vi.fn(async (_query: unknown, vars: { offset?: number; limit?: number }) => {
        const offset = vars.offset ?? 0;
        const readCount = vars.limit ?? 0;
        calls.push({ offset, limit: readCount });
        // A full page of plausible, never-before-seen nodes for ANY offset.
        const hits = Array.from({ length: readCount }, (_, i) => ({
          node: msg(`chats:team:messages:${offset + i}-cap`, { seq: offset + i + 1 }),
        }));
        return { findNodes: { total: null, hits } };
      }),
    } as any;

    await expect(loadChatMessages(growing, 'mem-1', 'chats:team')).rejects.toThrow(
      /never ran short/,
    );
    // Exact: the first read, then 23 doubling probes (150·2^0 … 150·2^22,
    // the last below 2^30; 150·2^23 crosses it and throws). Every request is
    // page-bounded. The cap rejection is NOT retried — no honest server
    // reads full forever — so the count stays one gallop.
    expect(calls[0].limit).toBe(Math.ceil(CHAT_PAGE_SIZE * 1.5));
    expect(calls).toHaveLength(24);
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
