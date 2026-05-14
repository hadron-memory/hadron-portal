import type { Chat } from '$lib/types';

/**
 * Resolve which chat to auto-resume when the Agent Chat tab mounts.
 *
 * Reads `?chat=<id>` from the URL and returns it only if the persisted
 * chat list contains a chat with that loc. Returning null on a missing
 * id avoids a 404 from /api/agent-chat/resume when a chat has been
 * deleted in another tab — the caller can clear the stale URL param.
 */
export function resolveActiveChatFromUrl(url: URL, chats: Chat[]): string | null {
  const fromUrl = url.searchParams.get('chat');
  if (!fromUrl) return null;
  return chats.some((c) => c.loc === fromUrl) ? fromUrl : null;
}
