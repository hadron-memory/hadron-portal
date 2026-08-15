import type { GraphQLClient } from 'graphql-request';
import { CREATE_NODE_MUTATION, NODES_BY_LOC_PREFIX_QUERY } from '$lib/server/queries';
import type { MemoryNode } from '$lib/types';

// A chat node is an ordinary node tagged `team-chat`; its messages live one
// level down under `<chat.loc>:messages:`. Both the standalone chat page and
// the node detail page's Chat tab read/write through this module so the two
// surfaces can never drift apart on layout or authorship.
export const TEAM_CHAT_TAG = 'team-chat';

export function isTeamChatNode(node: Pick<MemoryNode, 'tags'> | null | undefined): boolean {
  return !!node?.tags?.includes(TEAM_CHAT_TAG);
}

export type ChatMessage = {
  id: string;
  name: string;
  author: string;
  content: string;
  createdAt: string;
  nodeData: { loc: string };
};

export function messagesPrefix(chatLoc: string): string {
  return `${chatLoc}:messages:`;
}

/**
 * Load a chat node's messages, oldest first.
 *
 * Messages are stored at `{chat.loc}:messages:{id}` so other content
 * (attachments, etc.) can live under the chat without colliding. #447: the
 * memory layout's `graphNodes` is a slim projection without content/createdAt,
 * so the children are fetched directly with full fields.
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

  return data.findNodes.hits
    .map((h) => h.node)
    .filter((n: MemoryNode) => {
      if (!n?.loc?.startsWith(prefix)) return false;
      // Only direct message children — no further nesting.
      return !n.loc.slice(prefix.length).includes(':');
    })
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    .map((msg) => {
      const msgData = msg.data as Record<string, unknown> | null;
      return {
        id: msg.id,
        name: msg.name || 'Unknown',
        author: (msgData?.author as string) || msg.name || 'Unknown',
        content: msg.content || (msgData?.body as string) || '',
        createdAt: msg.createdAt,
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
 * Append a message to a chat node.
 *
 * Message locs embed an ISO timestamp + username, so each send targets a fresh
 * loc — a pure create, which makes a same-second double submit surface as a
 * loud conflict error rather than silently merging.
 */
export async function postChatMessage(
  client: GraphQLClient,
  args: { memoryId: string; chatLoc: string; author: string; content: string; now?: Date },
): Promise<MemoryNode> {
  const now = args.now ?? new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '').slice(0, -1); // 2026-06-21T223100Z
  const messageLoc = `${messagesPrefix(args.chatLoc)}${timestamp}-${args.author}`;

  const { createNode } = await client.request<{ createNode: MemoryNode }>(CREATE_NODE_MUTATION, {
    input: {
      memoryId: args.memoryId,
      loc: messageLoc,
      name: args.author,
      nodeType: 'message',
      data: { body: args.content, author: args.author },
    },
  });
  return createNode;
}
