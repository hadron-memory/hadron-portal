import { AGENT_CHAT_KEY } from '$lib/app-chats';
import type { Chat } from '$lib/types';

/**
 * Resolve which chat to auto-resume when the Agent Chat tab mounts.
 *
 * Reads `?chat=agent chat&agentChat=<loc>` on an App, or legacy `?chat=<loc>`
 * elsewhere. An App may opt into legacy recovery only after proving its
 * selector unresolved. Returns a loc only if the persisted
 * chat list contains a chat with that loc. Returning null on a missing
 * id avoids a 404 from /api/agent-chat/resume when a chat has been
 * deleted in another tab — the caller can clear the stale URL param.
 */
export function resolveActiveChatFromUrl(
  url: URL,
  chats: Chat[],
  { appChat = false, allowLegacyAppChat = false }: { appChat?: boolean; allowLegacyAppChat?: boolean } = {},
): string | null {
  let param = appChat ? 'agentChat' : 'chat';
  if (appChat && url.searchParams.get('chat') !== AGENT_CHAT_KEY) {
    // Only the App can prove that its filtered selector read and requested-root lookup
    // did not resolve this value. Never reinterpret a known shared/team selector.
    if (!allowLegacyAppChat || url.searchParams.has('agentChat')) return null;
    param = 'chat';
  }
  const fromUrl = url.searchParams.get(param);
  if (!fromUrl) return null;
  return chats.some((c) => c.loc === fromUrl) ? fromUrl : null;
}
