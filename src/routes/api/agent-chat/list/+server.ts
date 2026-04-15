import { gqlClient } from '$lib/server/api';
import { MY_CHATS_QUERY } from '$lib/server/queries';
import type { Chat } from '$lib/types';
import type { RequestHandler } from './$types';

/**
 * GET /api/agent-chat/list?agentId=...
 * Returns the current user's saved chats for an agent, newest first.
 */
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
      agentId,
    });
    return new Response(JSON.stringify({ chats: result.myChats }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to list chats';
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
