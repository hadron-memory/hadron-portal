import type { GraphQLClient } from 'graphql-request';
import type { TeamChatMessage } from '$lib/types';
import { APP_CHAT_TARGET_QUERY, CHANNEL_CHAT_TARGET_QUERY, CHANNEL_MESSAGES_QUERY, CREATE_CHANNEL_MESSAGE_MUTATION } from './queries';

async function target(client: GraphQLClient, appRef: string, channelRef: string) {
  const [appResult, channelResult] = await Promise.all([
    client.request<{ app: { id: string } | null }>(APP_CHAT_TARGET_QUERY, { ref: appRef }),
    client.request<{ channel: { id: string; memory: { appId: string | null } } | null }>(CHANNEL_CHAT_TARGET_QUERY, { ref: channelRef }),
  ]);
  const r = { ...appResult, ...channelResult };
  // This is route/target consistency, not a second authorization rule. The
  // caller's token goes to every server gate, and a post never falls back.
  if (!r.app || !r.channel || r.channel.memory.appId !== r.app.id) throw new Error('Channel unavailable');
  return r.channel.id;
}
export async function readChannelPage(client: GraphQLClient, appRef: string, channelRef: string,
  cursor: { sinceSeq?: number; beforeSeq?: number }) {
  const id = await target(client, appRef, channelRef);
  const page = await client.request<{ channelMessages: { items: TeamChatMessage[]; total: number } }>(CHANNEL_MESSAGES_QUERY, {
    channelRef: id, ...(cursor.sinceSeq !== undefined ? { sinceSeq: cursor.sinceSeq } : { beforeSeq: cursor.beforeSeq ?? 2147483647 }), limit: 20,
  });
  return page.channelMessages;
}
export async function postToChannel(client: GraphQLClient, appRef: string, channelRef: string, body: string, replyToSeq?: number) {
  const id = await target(client, appRef, channelRef);
  return client.request(CREATE_CHANNEL_MESSAGE_MUTATION, { channelRef: id, body, replyToSeq });
}
