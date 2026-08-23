import type { GraphQLClient } from 'graphql-request';
import {
  CREATE_NODE_MUTATION,
  CREATE_TEAM_CHAT_MESSAGE_MUTATION,
  NODES_BY_LOC_PREFIX_QUERY,
} from '$lib/server/queries';
import { TEAM_CHAT_LOC } from '$lib/app-chats';
import type { MemoryNode } from '$lib/types';

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
// `cor:agt:020:04` warns about.
export { TEAM_CHAT_LOC } from '$lib/app-chats';
/** The nodeTypes that ARE messages. Anything else under the prefix is off-road
 *  content (an attachment, a hand-written note) and is not a bubble. */
const MESSAGE_NODE_TYPES = ['chat-message', 'message'];

export function isChatNode(node: Pick<MemoryNode, 'tags' | 'nodeType'> | null | undefined): boolean {
  if (!node) return false;
  return node.nodeType === CHAT_NODE_TYPE || !!node.tags?.includes(TEAM_CHAT_TAG);
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
): ChatPostTarget {
  if (!isChatNode(node)) return { kind: 'none' };
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
  return `${chatLoc}:messages:`;
}

/**
 * Load a chat node's messages, oldest first.
 *
 * #447: the memory layout's `graphNodes` is a slim projection without
 * content/data/createdAt, so the children are fetched directly with full fields.
 *
 * Ordering: a platform chat carries `seq` (unique per chat, ascending from 1) and
 * is ordered by it; a legacy thread has none and falls back to creation time.
 * The two never mix within one chat, so this is a total order in practice.
 */
export async function loadChatMessages(
  client: GraphQLClient,
  memoryId: string,
  chatLoc: string,
  limit = 2000,
): Promise<ChatMessage[]> {
  const prefix = messagesPrefix(chatLoc);
  const data = await client.request<{ findNodes: { hits: Array<{ node: MemoryNode }> } }>(
    NODES_BY_LOC_PREFIX_QUERY,
    { memoryId, locPrefix: prefix, limit },
  );

  const messages = data.findNodes.hits
    .map((h) => h.node)
    .filter((n: MemoryNode) => {
      if (!n?.loc?.startsWith(prefix)) return false;
      // Only direct children — no further nesting.
      if (n.loc.slice(prefix.length).includes(':')) return false;
      return MESSAGE_NODE_TYPES.includes(n.nodeType);
    });

  const bySeq = messages.length > 0 && messages.every((n) => typeof n.seq === 'number');
  messages.sort((a, b) =>
    bySeq
      ? (a.seq as number) - (b.seq as number)
      : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return messages.map((msg) => {
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
  });
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
