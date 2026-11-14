import { AGENT_CHAT_KEY } from '$lib/app-chats';
import type { Chat } from '$lib/types';

/**
 * Resolve which chat to auto-resume when the Agent Chat tab mounts.
 *
 * Reads `?chat=agent chat&agentChat=<loc>` on an App, or legacy `?chat=<loc>`
 * elsewhere, and returns it only if the persisted
 * chat list contains a chat with that loc. Returning null on a missing
 * id avoids a 404 from /api/agent-chat/resume when a chat has been
 * deleted in another tab — the caller can clear the stale URL param.
 */
export function resolveActiveChatFromUrl(url: URL, chats: Chat[], appChat = false): string | null {
  // App selectors and personal chat locs live in different namespaces. A raw
  // loc may name a shared chat too, so it must never be an agent-chat alias.
  if (appChat && url.searchParams.get('chat') !== AGENT_CHAT_KEY) return null;
  const fromUrl = url.searchParams.get(appChat ? 'agentChat' : 'chat');
  if (!fromUrl) return null;
  return chats.some((c) => c.loc === fromUrl) ? fromUrl : null;
}
