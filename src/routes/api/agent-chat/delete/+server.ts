import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { DELETE_CHAT_MUTATION } from '$lib/server/queries';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/delete
 * Body: { chatId: string }
 *
 * Soft-deletes a saved chat and all its messages.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let body: { chatId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!body.chatId) {
    return new Response(JSON.stringify({ error: 'chatId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    await gqlClient(locals.token).request(DELETE_CHAT_MUTATION, { chatId: body.chatId });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = extractGqlError(e, 'Failed to delete chat');
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
