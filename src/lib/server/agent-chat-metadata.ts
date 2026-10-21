import type { GraphQLClient } from 'graphql-request';
import { MY_CHATS_QUERY } from '$lib/server/queries';
import type { Chat } from '$lib/types';

const CHAT_LIST_PAGE_SIZE = 100;

/** Keep the server's agent/caller visibility and newest-first order on every page. */
async function* chatPages(client: GraphQLClient, agentRef: string): AsyncGenerator<Chat[]> {
  for (let offset = 0; ; offset += CHAT_LIST_PAGE_SIZE) {
    const { myChats } = await client.request<{ myChats: Chat[] }>(MY_CHATS_QUERY, {
      agentRef, limit: CHAT_LIST_PAGE_SIZE, offset,
    });
    yield myChats;
    // resolvers.query.chat.ts maps every Prisma row after take/skip, with no
    // post-filter or smaller hard cap. Infer exhaustion BEFORE the list route
    // filters team chat; a filtered page's length would not establish the end.
    if (myChats.length < CHAT_LIST_PAGE_SIZE) return;
  }
}

export async function loadAgentChats(client: GraphQLClient, agentRef: string): Promise<Chat[]> {
  const chats: Chat[] = [];
  for await (const page of chatPages(client, agentRef)) chats.push(...page);
  return chats;
}

export async function findAgentChat(client: GraphQLClient, agentRef: string, chatLoc: string): Promise<Chat | undefined> {
  for await (const page of chatPages(client, agentRef)) {
    const chat = page.find(candidate => candidate.loc === chatLoc);
    if (chat) return chat;
  }
  return undefined;
}
