import { AGENT_CHAT_PAGE_SIZE } from '$lib/agent-chat-window';
import { loadAgentChatPage } from '$lib/server/agent-chat';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { MY_CHATS_QUERY } from '$lib/server/queries';
import type { Chat } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/resume
 * Body: { agentId: string, chatId: string }
 *
 * Loads the chat's metadata (title, conversation, current stage) and
 * message history so the frontend can re-render an existing chat from
 * scratch. Doesn't create anything; the next `/turn` call will compile
 * the current stage prompt and drive the LLM normally.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { agentId?: string; chatId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!body.agentId || !body.chatId) {
    return new Response(JSON.stringify({ error: 'agentId and chatId are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const client = gqlClient(locals.token);
    // Use myChats to find the chat metadata — we already have ownership
    // filtering baked in there. Small N per user, simple.
    // #793: the TAIL page, not the whole conversation. `hasOlder` is what tells
    // the client a scroll-up has somewhere to go; the pages before this one come
    // from the sibling `/older` endpoint, deliberately kept off this path so a
    // scroll-up never re-runs the chat-metadata read or its 404 branch (#785).
    const [listResult, page] = await Promise.all([
      client.request<{ myChats: Chat[] }>(MY_CHATS_QUERY, { agentRef: body.agentId }),
      loadAgentChatPage(client, body.chatId, null, AGENT_CHAT_PAGE_SIZE),
    ]);
    const chat = listResult.myChats.find((c) => c.loc === body.chatId);
    if (!chat) {
      return new Response(JSON.stringify({ error: 'Chat not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(
      JSON.stringify({
        chat,
        messages: page.messages,
        hasOlder: page.hasOlder,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    const msg = extractGqlError(e, 'Failed to resume chat');
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
