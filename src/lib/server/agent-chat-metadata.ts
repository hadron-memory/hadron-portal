import type { GraphQLClient } from 'graphql-request';
import { MY_CHATS_QUERY } from '$lib/server/queries';
import type { Chat } from '$lib/types';

const CHAT_LIST_PAGE_SIZE = 100;

/** Keep the server's agent/caller visibility and newest-first order on every page. */
async function* chatPages(client: GraphQLClient, agentRef: string): AsyncGenerator<Chat[]> {
  for (let offset = 0; ;) {
    const { myChats } = await client.request<{ myChats: Chat[] }>(MY_CHATS_QUERY, {
      agentRef, limit: CHAT_LIST_PAGE_SIZE, offset,
    });
    // hrn:node:hadronmemory.com:specs:cor:api:120:04: complete consumers
    // drain until empty. A server cap may make a nonempty page shorter than
    // requested; advancing by the requested size would skip visible chats.
    if (myChats.length === 0) return;
    yield myChats;
    offset += myChats.length;
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
