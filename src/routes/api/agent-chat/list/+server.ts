import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { MY_CHATS_QUERY } from '$lib/server/queries';
import { TEAM_CHAT_LOC } from '$lib/server/team-chat';
import type { Chat } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * GET /api/agent-chat/list?agentId=...
 * Returns the current user's saved chats for an agent, newest first.
 *
 * The team chat is filtered out — see `isAgentChat`.
 */
/**
 * A team App's chat (`chats:team`, server #939) is NOT an agent conversation,
 * but `myChats` cannot tell them apart: it selects every `chats:*` root in the
 * App's app-class memories, and the team chat lives at exactly that address
 * with `data.scope='shared'` already stamped.
 *
 * Listing it here is not cosmetic. The agent-chat surface then offers, on a
 * thread of real teammate posts: a title derived from the first message body,
 * a transcript that renders every author as the same bubble (the team envelope
 * carries `authorName`/`authorWorkerId`, not `role`), a composer that POSTs an
 * LLM turn straight past `createTeamChatMessage`'s seq allocator and
 * worker-authorship gate, and a delete that soft-deletes the root AND every
 * message in it.
 *
 * Excluding it by its canonical loc is the narrowest correct filter: `loc` is
 * the address the server's own `TEAM_CHAT_LOC` constant pins, so this cannot
 * catch a user's chat by accident. The team chat's real home is the chat page
 * at `/app/memories/<memId>/nodes/<nodeId>/chat`, which renders the envelope
 * properly and posts through the platform operation.
 *
 * This is a client-side backstop, not the fix: every other `myChats` consumer
 * has the same problem, so the exclusion belongs in the resolver
 * (hadron-server#1030). Keep this filter when that lands — it costs one
 * comparison and it is what makes the portal correct against an older server.
 */
function isAgentChat(chat: Chat): boolean {
  return chat.loc !== TEAM_CHAT_LOC;
}

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const agentId = url.searchParams.get('agentId');
  if (!agentId) {
    return new Response(JSON.stringify({ error: 'agentId query param is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await gqlClient(locals.token).request<{ myChats: Chat[] }>(MY_CHATS_QUERY, {
      agentRef: agentId,
    });
    return new Response(JSON.stringify({ chats: (result.myChats ?? []).filter(isAgentChat) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = extractGqlError(e, 'Failed to list chats');
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
