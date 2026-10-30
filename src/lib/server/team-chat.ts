import type { GraphQLClient } from 'graphql-request';
import {
  CREATE_NODE_MUTATION,
  CREATE_TEAM_CHAT_MESSAGE_MUTATION,
  LEGACY_THREAD_PROBE_QUERY,
  NODES_BY_LOC_PREFIX_QUERY,
  TEAM_CHAT_MESSAGES_QUERY,
} from '$lib/server/queries';
import { TEAM_CHAT_LOC } from '$lib/app-chats';
import { NO_TEAM_FILTER, filterVariablesOf, type TeamChatFilter } from '$lib/team-chat-filter';
import type { MemoryNode, TeamChatMessage } from '$lib/types';

// A chat node holds a message thread one level down, under `<chat.loc>:messages:`.
// Both the standalone chat page and the node detail page's Chat tab read/write
// through this module so the two surfaces can never drift apart.
//
// Two generations of chat live in the corpus:
//   - PLATFORM (server #939, current): the chat root is `nodeType: 'chat'`,
//     messages are `nodeType: 'chat-message'` with the body in `content`, an
//     author envelope in `data`, and an atomically-allocated ordering key in
//     `seq`. Writes go through `createTeamChatMessage` — the resolver allocates
//     the seq under the chat-root lock and maintains the root's counters, so a
//     hand-rolled node create is exactly the bug that operation prevents.
//   - LEGACY (this portal's own earlier convention): the root is tagged
//     `team-chat`, messages are `nodeType: 'message'` with the body in
//     `data.body` and no seq. Still readable and still writable, since such a
//     chat has no App to post through.
export const TEAM_CHAT_TAG = 'team-chat';
export const CHAT_NODE_TYPE = 'chat';
/** Canonical loc of the ONE team chat in a team App's shared memory (server
 *  #939, `TEAM_CHAT_LOC`). `createTeamChatMessage` addresses a chat by appRef
 *  alone, so this loc is the only thread it can post to. */
// #744: re-exported from the CLIENT-safe module rather than declared twice.
// Svelte components need this constant to render the Chats selector, and they
// cannot import from `$lib/server/*`, so the definition lives there and this
// module consumes it. Two copies of a well-known loc is exactly the drift
// `hrn:node:hadronmemory.com:specs:cor:agt:020:04` warns about.
export { TEAM_CHAT_LOC } from '$lib/app-chats';
/** The platform message type (server #939) and this portal's legacy one. */
export const PLATFORM_MESSAGE_NODE_TYPE = 'chat-message';
const LEGACY_MESSAGE_NODE_TYPE = 'message';
/** The nodeTypes that ARE messages. Anything else under the prefix is off-road
 *  content (an attachment, a hand-written note) and is not a bubble. */
const MESSAGE_NODE_TYPES = [PLATFORM_MESSAGE_NODE_TYPE, LEGACY_MESSAGE_NODE_TYPE];
/** The loc segment a chat's thread hangs under — `<chatLoc>:messages:<atom>`. */
const MESSAGES_SEGMENT = 'messages';

/**
 * Whether a node is a chat ROOT.
 *
 * - A MESSAGE is never a root, whatever its tags (#926 part 1). Legacy
 *   messages carry the `team-chat` tag, and so do the platform `chat-message`
 *   nodes cloned from them. The test is the one `isChatMessageNode` applies,
 *   so a node is one or the other, never both.
 * - `nodeType: 'chat'` is a root (the platform, server #939).
 * - The `team-chat` TAG alone is NOT enough (#926 part 2). A legacy root is an
 *   ordinary node whose only marker is that tag, and so is a finding or a task
 *   that is merely ABOUT the team chat (Chip's two reproductions). A tagged
 *   node is a legacy root only on POSITIVE evidence of a legacy thread: a
 *   direct `message` child, from `probeLegacyThread`. Holger ruled that an
 *   EMPTY tag-only legacy root may lose its chat UI and first-post support
 *   (team chat #2078).
 *
 * `legacyThread` must be true only on positive evidence. A failed or truncated
 * probe is not evidence, and neither is the layout's `graphNodes` (partial,
 * permission-filtered, or empty on a failed read).
 */
export function isChatNode(
  node: Pick<MemoryNode, 'tags' | 'nodeType' | 'loc'> | null | undefined,
  opts: { legacyThread?: boolean } = {},
): boolean {
  if (!node) return false;
  if (isChatMessageNode(node)) return false;
  if (node.nodeType === CHAT_NODE_TYPE) return true;
  return !!node.tags?.includes(TEAM_CHAT_TAG) && opts.legacyThread === true;
}

/** Whether classifying this node needs `probeLegacyThread`: a tagged, non-chat, non-message node. */
export function needsLegacyThreadProbe(node: Pick<MemoryNode, 'tags' | 'nodeType' | 'loc'>): boolean {
  return node.nodeType !== CHAT_NODE_TYPE && !isChatMessageNode(node) && !!node.tags?.includes(TEAM_CHAT_TAG);
}

/** Probe window. A legacy thread's first direct message sorts first by loc, so one page answers. */
const LEGACY_THREAD_PROBE_LIMIT = 50;

/**
 * Whether a tag-only node has a legacy thread (#926), asked of the server with
 * the VIEWER's token, so it can only find messages the viewer may read anyway.
 *
 * - `present`: a `message` node that is a DIRECT child (`<loc>:messages:<atom>`);
 *   a deeper descendant is not a thread message (`loadChatMessages`'s rule).
 * - `absent`: the complete answer holds none.
 * - `unknown`: the window was truncated with no direct message in it, or the
 *   read failed. NOT evidence either way; callers treat it as "not a chat".
 */
export type LegacyThread = 'present' | 'absent' | 'unknown';

export async function probeLegacyThread(client: GraphQLClient, memoryId: string, loc: string): Promise<LegacyThread> {
  try {
    const r = await client.request<{
      findNodes: { total: number | null; hits: Array<{ node: { loc: string; nodeType: string } }> };
    }>(LEGACY_THREAD_PROBE_QUERY, { memoryId, locPrefix: messagesPrefix(loc), limit: LEGACY_THREAD_PROBE_LIMIT });
    const hits = r.findNodes.hits;
    if (hits.some(({ node }) => node.nodeType === LEGACY_MESSAGE_NODE_TYPE && chatRootLocForMessage(node.loc) === loc)) {
      return 'present';
    }
    const total = r.findNodes.total;
    return total !== null && total <= hits.length ? 'absent' : 'unknown';
  } catch (e) {
    console.warn(`[team-chat] legacy-thread probe failed for ${loc}:`, e);
    return 'unknown';
  }
}

/**
 * The evidence `isChatNode` / `chatPostTarget` need for THIS node: probes only
 * when the node is tag-only, so every other node pays nothing.
 */
export async function legacyThreadEvidence(
  client: GraphQLClient,
  node: Pick<MemoryNode, 'tags' | 'nodeType' | 'loc' | 'memoryId'>,
): Promise<{ legacyThread: boolean }> {
  if (!needsLegacyThreadProbe(node)) return { legacyThread: false };
  return { legacyThread: (await probeLegacyThread(client, node.memoryId, node.loc)) === 'present' };
}

/**
 * The loc of the chat a message hangs under, or null when the loc is not a
 * message address at all.
 *
 * The inverse of `messagesPrefix`: a message sits at `<chatLoc>:messages:<atom>`.
 * The LAST `:messages:` is the boundary — a chat whose own loc contained the
 * word would otherwise be cut at the wrong one — and the tail must be a single
 * atom, which is exactly the "direct children only" rule `loadChatMessages`
 * applies before it will render a node as a bubble. Keeping the two in
 * agreement is the point: a node this returns a root for is a node that thread
 * actually shows.
 */
export function chatRootLocForMessage(loc: string | null | undefined): string | null {
  if (!loc) return null;
  const marker = `:${MESSAGES_SEGMENT}:`;
  const at = loc.lastIndexOf(marker);
  if (at <= 0) return null; // absent, or nothing before it to be the root
  const tail = loc.slice(at + marker.length);
  if (!tail || tail.includes(':')) return null;
  return loc.slice(0, at);
}

/**
 * Is this node a chat MESSAGE — the thing that renders as a bubble (#725)?
 *
 * `chat-message` is the platform type (server #939) and is unambiguous, so the
 * type alone answers it. `message` is the legacy portal-era type and is a
 * generic English word that another corpus may well use for something that is
 * not a chat at all, so it additionally has to be ADDRESSED as a message.
 * Marking a node "Chat Message:" on the strength of a common type word is the
 * quiet kind of wrong — it renders perfectly and says something false.
 */
export function isChatMessageNode(
  node: Pick<MemoryNode, 'nodeType' | 'loc'> | null | undefined,
): boolean {
  if (!node) return false;
  if (node.nodeType === PLATFORM_MESSAGE_NODE_TYPE) return true;
  return node.nodeType === LEGACY_MESSAGE_NODE_TYPE && chatRootLocForMessage(node.loc) !== null;
}

/**
 * Where a post to this chat should go — and the answer is a property of the
 * NODE, never of its memory.
 *
 * `createTeamChatMessage(appRef:)` writes to the App's one well-known team
 * chat; it takes no chat address. So routing any other chat node through it
 * would report success while the message landed in a different thread — which
 * is what "the memory has an appId" as a discriminator would do to a legacy
 * thread that happens to live in an App-class memory.
 *
 * `none` means the thread is readable but has nowhere to post: a chat node that
 * is neither the App's team chat nor a legacy tagged thread. Better a missing
 * composer than a message that silently lands somewhere else.
 */
export type ChatPostTarget =
  | { kind: 'platform'; appId: string }
  | { kind: 'legacy' }
  | { kind: 'none' };

export function chatPostTarget(
  node: Pick<MemoryNode, 'tags' | 'nodeType' | 'loc'> & { memory?: { appId?: string | null } | null },
  opts: { legacyThread?: boolean } = {},
): ChatPostTarget {
  if (!isChatNode(node, opts)) return { kind: 'none' };
  const appId = node.memory?.appId ?? null;
  if (node.nodeType === CHAT_NODE_TYPE && node.loc === TEAM_CHAT_LOC && appId) {
    return { kind: 'platform', appId };
  }
  if (node.tags?.includes(TEAM_CHAT_TAG)) return { kind: 'legacy' };
  return { kind: 'none' };
}

export type ChatMessage = {
  id: string;
  name: string;
  author: string;
  content: string;
  createdAt: string;
  seq: number | null;
  nodeData: { loc: string };
};

export function messagesPrefix(chatLoc: string): string {
  return `${chatLoc}:${MESSAGES_SEGMENT}:`;
}

/**
 * How many messages a chat surface loads at a time (#793).
 *
 * @Holger's ruling: "quite a bit more than a screenful — that allows the user
 * to scroll up without hesitation". A screenful is roughly 10–15 messages
 * depending on length, so this is several, and the reader should reach the top
 * of it rarely. It replaces a flat `limit = 2000`, which was not a window at
 * all — it was "load everything and hope".
 */
export const CHAT_PAGE_SIZE = 100;

/**
 * Fetch enough NODES to yield a full page of MESSAGES.
 *
 * The loc-prefix query returns every descendant of `<chat>:messages:`, and this
 * module then drops anything that is not a direct child or not a message type.
 * So a server page of N nodes yields ≤N messages, and a page whose extras were
 * all filtered out would come back short — which an infinite scroll reads as
 * "no more history" and stops. Over-fetching absorbs the difference; the extra
 * cost is bounded and the alternative is a scrollback that silently ends early.
 *
 * Off-road content under a chat prefix is rare, so this is deliberately a small
 * multiplier rather than a retry loop: if it is ever not enough the page is
 * short, never wrong, and the `hasOlder` flag below is computed from the SERVER's
 * total rather than from what survived filtering.
 */
const NODE_OVERFETCH = 1.5;

/**
 * Which key orders THIS chat's messages (#793).
 *
 * The two generations need different keys and the choice is not cosmetic — it
 * decides which messages a paged window contains:
 *
 *   - PLATFORM (`nodeType: 'chat'`, messages `chat-message`) carries `seq`.
 *   - LEGACY (`team-chat` tag, messages `message`) has NO seq at all; its loc
 *     atom is an ISO timestamp, so `loc` is lexicographically chronological.
 *
 * Sorting a legacy chat by `seq` orders it by a field every row leaves null —
 * an arbitrary order, which is harmless while the whole thread fits in one page
 * (the client re-sorts) and silently WRONG the moment it is paged, because the
 * window is then a slice of an arbitrary order.
 *
 * The inverse is a trap too: `loc` is not safe for a PLATFORM chat, because the
 * server pads the seq atom to three digits, so `"1000-…" < "999-…"` and the
 * order inverts past a thousand messages.
 */
export function chatSortKey(node: Pick<MemoryNode, 'nodeType'>): 'seq' | 'loc' {
  return node.nodeType === CHAT_NODE_TYPE ? 'seq' : 'loc';
}

export type ChatPage = {
  messages: ChatMessage[];
  /** The server's count of nodes under the prefix — not of messages. */
  total: number;
  /** Is there anything before this window? Drives the scroll-up affordance. */
  hasOlder: boolean;
  /** Node offset this window started at; pass `before` to walk further back. */
  offset: number;
};

/**
 * Load a WINDOW of a chat's messages, newest-last, ending at the tail by default.
 *
 * #793. Ordering is the subtle part and it decides the paging key:
 *
 *   - A PLATFORM chat (`chat-message`) carries `seq` — unique per chat,
 *     allocated atomically ascending — so it sorts by `seq` server-side.
 *   - A LEGACY chat (`message`) has no seq at all, and sorts by `loc`, whose
 *     atom is an ISO timestamp (`2026-06-21T223100Z-author`) and therefore
 *     lexicographically chronological.
 *
 * The two never mix within one chat, which is what makes a single sort key
 * per chat a total order.
 *
 * **`loc` is NOT a safe key for a platform chat, and that is not obvious.** The
 * server pads the seq atom to three digits (`chatRoot.ts`, `padStart(3, '0')`),
 * so `"1000-…" < "999-…"` lexicographically — message 1000 sorts BEFORE message
 * 999. Loc ordering silently inverts past a thousand messages, which is exactly
 * the length at which pagination matters. Hence `seq` for platform chats, and
 * `loc` only where seq does not exist and the atom is a timestamp.
 */
export async function loadChatMessages(
  client: GraphQLClient,
  memoryId: string,
  chatLoc: string,
  opts: {
    /** Messages per page. */
    limit?: number;
    /** Walk backwards: load the window ENDING at this node offset. */
    before?: number;
    /** `seq` for a platform chat, `loc` for a legacy one. See the docblock. */
    sort?: 'seq' | 'loc';
  } = {},
): Promise<ChatPage> {
  const limit = opts.limit ?? CHAT_PAGE_SIZE;
  const prefix = messagesPrefix(chatLoc);
  const fetchCount = Math.ceil(limit * NODE_OVERFETCH);

  // A first read with limit 0 would be a wasted round trip, so the count comes
  // back with the window: ask for the tail optimistically, then correct.
  //
  // #793 (@copilot on PR #797): when `before` is given the window is ALREADY
  // known, so this is one request, not two. The old shape always probed at
  // offset 0 first — fetching the OLDEST page and discarding it — so every
  // scroll-up cost two round trips and one of them was guaranteed waste. The
  // count comes back with whichever window we actually want.
  const sort = opts.sort ?? 'seq';
  const firstOffset = opts.before === undefined ? 0 : Math.max(0, opts.before - fetchCount);
  const first = await client.request<{
    findNodes: { total: number | null; hits: Array<{ node: MemoryNode }> };
  }>(NODES_BY_LOC_PREFIX_QUERY, {
    memoryId,
    locPrefix: prefix,
    limit: fetchCount,
    offset: firstOffset,
    sort,
  });
  const total = first.findNodes.total ?? first.findNodes.hits.length;

  // Where this window starts. `before` walks backwards from a previous window's
  // cursor; absent, we want the TAIL — the newest page — which is the end of a
  // list the server pages from the front, and which needs `total` to locate.
  const end = opts.before ?? total;
  const offset = Math.max(0, end - fetchCount);

  // A second request is needed ONLY when the tail turned out not to start where
  // we guessed — i.e. an unpaged first read of a thread longer than one page.
  // `slice(0, end - offset)` is load-bearing, not defensive. When `before` is
  // smaller than the over-fetch, `firstOffset` clamps to 0 and the response
  // holds MORE than the window asked for — everything from the start of the
  // thread. Reusing it whole hands back the newest page again: measured, a
  // `before=42` request on a 142-message thread returned 100 messages, the very
  // page the reader already had, with `hasOlder: true` so it would have looped.
  // The hits start at `offset`, so the window is the first `end - offset` of
  // them.
  const hits =
    offset === firstOffset
      ? first.findNodes.hits.slice(0, end - offset)
      : (
          await client.request<{ findNodes: { hits: Array<{ node: MemoryNode }> } }>(
            NODES_BY_LOC_PREFIX_QUERY,
            {
              memoryId,
              locPrefix: prefix,
              limit: Math.min(fetchCount, end - offset),
              offset,
              sort,
            },
          )
        ).findNodes.hits;

  const messages = hits
    .map((h) => h.node)
    .filter((n: MemoryNode) => {
      if (!n?.loc?.startsWith(prefix)) return false;
      // Only direct children — no further nesting.
      if (n.loc.slice(prefix.length).includes(':')) return false;
      return MESSAGE_NODE_TYPES.includes(n.nodeType);
    });

  // #793 (@copilot on PR #797): sort on the SAME key the server paged by.
  //
  // This used to fall back to `createdAt` for a legacy chat while the server
  // ordered by `loc`. Two orders over one window is fine while the window is
  // the whole thread — the client's order is what renders — and wrong once
  // PAGED: the trim below takes "the last N" of the CLIENT order, while the
  // cursor describes a position in the SERVER order. If the two ever disagree
  // (a legacy `createdAt` edited, backfilled, or simply not matching its loc
  // timestamp) the window and the cursor describe different slices, and the
  // next page silently skips or repeats messages.
  //
  // `loc` is a total order on a legacy thread for the same reason it is the
  // paging key: the atom is an ISO timestamp.
  messages.sort((a, b) =>
    sort === 'seq'
      ? (a.seq ?? 0) - (b.seq ?? 0)
      : a.loc.localeCompare(b.loc),
  );

  // #793: trim to the PAGE SIZE after filtering.
  //
  // The fetch deliberately over-reads nodes to absorb non-message children, but
  // without this the over-read silently becomes the window: with a page size of
  // 100 and a 1.5x over-fetch, a 142-message thread came back whole and the
  // scroll-up affordance never appeared, because nothing had been left behind.
  // Measured in the app on exactly that thread — the constant claimed 100 and
  // the reader got 142.
  //
  // Taking the LAST `limit` is right in both directions: at the tail it is the
  // newest page, and when walking backwards it is the slice adjacent to what
  // the reader already has.
  const windowed = messages.length > limit ? messages.slice(messages.length - limit) : messages;

  // The cursor is the NODE INDEX of the first message actually shown — not the
  // fetch offset. Those differ whenever the trim above dropped messages off the
  // front of a page that began at offset 0, which is exactly the case a thread
  // between `limit` and the over-fetched count lands in. Returning the fetch
  // offset there yields 0, the endpoint rejects it as a bad cursor, and the
  // scroll-up fetches forever without ever producing a message — measured, one
  // request and zero rows.
  //
  // Located by identity in `hits` rather than computed from the filtered count,
  // because the two differ by however many non-message nodes were interleaved,
  // and an approximate cursor skips or repeats a message at every page boundary.
  const firstShown = windowed[0];
  const idxInHits = firstShown ? hits.findIndex((h) => h.node.id === firstShown.id) : 0;
  const cursor = offset + (idxInHits < 0 ? 0 : idxInHits);

  return {
    messages: windowed.map((msg) => {
      const msgData = msg.data as Record<string, unknown> | null;
      return {
        id: msg.id,
        name: msg.name || 'Unknown',
        // `authorName` is the platform envelope's display field; `author` the
        // legacy one. `name` is the last resort — on a platform message it reads
        // "003-Iris" (the seq-prefixed node name), so it is genuinely a fallback.
        author:
          (msgData?.authorName as string) || (msgData?.author as string) || msg.name || 'Unknown',
        content: msg.content || (msgData?.body as string) || '',
        createdAt: msg.createdAt,
        seq: msg.seq ?? null,
        nodeData: { loc: msg.loc },
      };
    }),
    total,
    // Computed from the SERVER's node offset, never from how many messages
    // survived filtering — a page whose extras were all filtered out is short,
    // not final, and reading "fewer than asked" as "no more" is how an infinite
    // scroll stops early on a thread that has plenty left.
    // One condition now covers both cases, because the cursor is absolute:
    // anything before the first shown message is older, whether it was left
    // behind by the server offset or by the trim.
    hasOlder: cursor > 0,
    offset: cursor,
  };
}

export function chatAuthorName(user: unknown): string {
  const u = (user ?? {}) as Record<string, unknown>;
  return (
    (u.handle as string) ||
    (u.githubUsername as string) ||
    (u.name as string) ||
    (u.email as string)?.split('@')[0] ||
    'anon'
  );
}

/**
 * The loc-safe form of an author name. A loc's `:` is a segment separator, so
 * an author carrying one ("Jane: Ops", a pasted URN) would push the message a
 * level deeper and `loadChatMessages` would drop it as nested — the message
 * would vanish from the thread it was posted to. The human-readable name is
 * still stored verbatim in `name` and `data.author`; only the address is
 * squashed. (Legacy path only; the platform resolver has its own
 * `sanitizeLocAtom`.)
 */
export function locSafeAuthor(author: string): string {
  const safe = author.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return safe || 'anon';
}

/**
 * Append a message to a chat, through the path `chatPostTarget` chose.
 *
 * `platform` is `createTeamChatMessage` — the operation that owns seq
 * allocation, the chat root's counters, and mention extraction.
 *
 * `legacy` is the node create for a `team-chat`-tagged thread, which has no
 * platform operation behind it. Message locs there embed an ISO timestamp +
 * username, so each send targets a fresh loc — a pure create, which makes a
 * same-second double submit surface as a loud conflict error rather than
 * silently merging.
 */
export async function postChatMessage(
  client: GraphQLClient,
  args: {
    target: ChatPostTarget;
    memoryId: string;
    chatLoc: string;
    author: string;
    content: string;
    now?: Date;
  },
): Promise<{ nodeId: string }> {
  if (args.target.kind === 'none') {
    // Callers gate on this first; the throw is the backstop that keeps a future
    // caller from falling through to a write the target explicitly denied.
    throw new Error('postChatMessage: this chat has no post target');
  }
  if (args.target.kind === 'platform') {
    const { createTeamChatMessage } = await client.request<{
      createTeamChatMessage: { nodeId: string };
    }>(CREATE_TEAM_CHAT_MESSAGE_MUTATION, { appRef: args.target.appId, body: args.content });
    return { nodeId: createTeamChatMessage.nodeId };
  }

  const now = args.now ?? new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '').slice(0, -1); // 2026-06-21T223100Z
  const messageLoc = `${messagesPrefix(args.chatLoc)}${timestamp}-${locSafeAuthor(args.author)}`;

  const { createNode } = await client.request<{ createNode: MemoryNode }>(CREATE_NODE_MUTATION, {
    input: {
      memoryId: args.memoryId,
      loc: messageLoc,
      name: args.author,
      nodeType: 'message',
      data: { body: args.content, author: args.author },
    },
  });
  return { nodeId: createNode.id };
}

// ── The APP team chat (server #939) ─────────────────────────────────────────
// Distinct from the node-based reading above: this is the `teamChatMessages`
// GraphQL operation, which is how the App page and its poll read the thread.
// It lives here, in the module named for the subject, so the page load
// (`+page.server.ts`) and the isolated poll endpoint (`team-chat/+server.ts`)
// share ONE definition — #785. Two copies of the paging rule below is exactly
// the drift its own comment warns about.

// Keep the first paint, each poll, and each scroll-back request bounded.
const TEAM_CHAT_PAGE_SIZE = 20;
// GraphQL Int's upper bound. `beforeSeq` already selects the newest page on
// deployed servers, independent of whether a cursor-less read defaults to the
// oldest or newest page during the server #1536 rollout.
const TEAM_CHAT_TAIL_CURSOR = 2147483647;

/**
 * Load the NEWEST page of a team chat.
 *
 * `beforeSeq` selects the newest page below a cursor, ascending for display.
 * A cursor-less read used to return the oldest page (#738); the server #1536
 * default is changing. Keeping this explicit cursor makes the portal's single
 * bounded request behave the same before and after that rollout.
 */
export async function loadTeamChatTail(
  client: GraphQLClient,
  appRef: string,
  filter: TeamChatFilter = NO_TEAM_FILTER,
): Promise<{ items: TeamChatMessage[]; total: number }> {
  return client
    .request<{ teamChatMessages: { items: TeamChatMessage[]; total: number } }>(
      TEAM_CHAT_MESSAGES_QUERY,
      { appRef, beforeSeq: TEAM_CHAT_TAIL_CURSOR, limit: TEAM_CHAT_PAGE_SIZE, ...filterVariablesOf(filter) },
    )
    .then((r) => r.teamChatMessages);
}

/**
 * The page of team-chat messages immediately BEFORE `beforeSeq` (#793).
 *
 * One request, no arithmetic. `beforeSeq` (server #1116) is the backward mirror
 * of the `sinceSeq` the poll uses: only messages with seq strictly less than the
 * cursor are considered, and the NEWEST of those come back — which is exactly a
 * scroll-up page, in the order the thread renders.
 *
 * The tail read uses a high cursor to get the same backward selection; once a
 * reader has a message on screen, the lowest shown seq is the next cursor.
 *
 * Deliberately NOT `offset`. The server ignores offset when beforeSeq is given,
 * and on this surface that matters more than anywhere: the team chat is written
 * continuously by workers while a reader is scrolled back, so a positional
 * cursor skips or duplicates as the list grows underneath it. That is the normal
 * case here, not an unlucky interleaving.
 */
export async function loadTeamChatOlder(
  client: GraphQLClient,
  appRef: string,
  beforeSeq: number,
  limit = TEAM_CHAT_PAGE_SIZE,
  filter: TeamChatFilter = NO_TEAM_FILTER,
): Promise<{ items: TeamChatMessage[]; total: number }> {
  return client
    .request<{ teamChatMessages: { items: TeamChatMessage[]; total: number } }>(
      TEAM_CHAT_MESSAGES_QUERY,
      { appRef, beforeSeq, limit, ...filterVariablesOf(filter) },
    )
    .then((r) => r.teamChatMessages);
}

/**
 * One forward page after the newest message already on screen. A small tail
 * poll can jump over messages if more than one page arrives while the tab is
 * hidden; `sinceSeq` advances through that backlog without inventing a gap.
 * Its `total` counts messages AFTER the cursor, not the whole thread.
 */
export async function loadTeamChatNewer(
  client: GraphQLClient,
  appRef: string,
  sinceSeq: number,
  filter: TeamChatFilter = NO_TEAM_FILTER,
): Promise<{ items: TeamChatMessage[]; total: number }> {
  return client
    .request<{ teamChatMessages: { items: TeamChatMessage[]; total: number } }>(
      TEAM_CHAT_MESSAGES_QUERY,
      { appRef, sinceSeq, limit: TEAM_CHAT_PAGE_SIZE, ...filterVariablesOf(filter) },
    )
    .then((r) => r.teamChatMessages);
}

/**
 * The server's typed refusal of a team filter (#1137), or null for any other
 * failure.
 *
 * `TEAM_CHAT_TEAM_HEAD_INVALID` is the ONE shape the server answers an unknown,
 * retired-and-unavailable or foreign head with, deliberately non-oracular: its
 * fixed text does not say which. The portal shows that text as-is and never
 * retries the read unfiltered (a fallback would show more than the reader asked
 * for under a filter they believe is on), and adds no candidate list of its own.
 * Any other failure stays a degraded read, not a refusal the reader is told
 * about (hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only).
 */
export const TEAM_CHAT_HEAD_REFUSAL_CODE = 'TEAM_CHAT_TEAM_HEAD_INVALID';

export function teamChatRefusalOf(e: unknown): { code: string; message: string } | null {
  const errors = (e as { response?: { errors?: Array<{ message?: unknown; extensions?: { code?: unknown } }> } })
    ?.response?.errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  if (first?.extensions?.code !== TEAM_CHAT_HEAD_REFUSAL_CODE) return null;
  if (typeof first.message !== 'string' || first.message === '') return null;
  return { code: TEAM_CHAT_HEAD_REFUSAL_CODE, message: first.message };
}
