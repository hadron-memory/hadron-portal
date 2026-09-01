import { AGENT_CHAT_PAGE_SIZE, hasOlderBefore, type AgentChatPage } from '$lib/agent-chat-window';
import { CHAT_HISTORY_QUERY } from '$lib/server/queries';
import type { ChatMessage } from '$lib/types';

interface HistoryClient {
  request<T>(document: string, variables?: Record<string, unknown>): Promise<T>;
}

/**
 * #793 — read one page of an agent chat: a newest-first window, oldest-first
 * order. The window size and the "is there more" rule live in
 * `$lib/agent-chat-window`, which the component shares.
 *
 * `beforeSeq` is the backward cursor (hadron-server#1116): strictly less than,
 * so the caller passes the oldest `seq` it already holds and gets the page
 * immediately preceding it. `null` reads the tail — the server treats null and
 * absent alike, so callers never have to build the variable set conditionally.
 *
 * The cursor NARROWS the candidate set and the window then takes the newest of
 * what remains, so the two compose rather than competing and paging never flips
 * which END a window comes from. Verified by hadron-server's
 * `resolvers.chatWindow.test.ts` — "walks the whole transcript without a gap or
 * a repeat", the property a scroll-up depends on and the one a positional
 * offset loses under concurrent writes.
 */
export async function loadAgentChatPage(
  client: HistoryClient,
  chatId: string,
  beforeSeq?: number | null,
  limit: number = AGENT_CHAT_PAGE_SIZE,
): Promise<AgentChatPage> {
  const { chatHistory } = await client.request<{ chatHistory: ChatMessage[] }>(
    CHAT_HISTORY_QUERY,
    { chatId, limit, beforeSeq: beforeSeq ?? null },
  );
  const messages = chatHistory ?? [];
  return { messages, hasOlder: hasOlderBefore(messages, limit) };
}
