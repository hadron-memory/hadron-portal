import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { UPDATE_CHAT_TITLE_MUTATION } from '$lib/server/queries';
import type { RequestHandler } from './$types';

/**
 * POST /api/agent-chat/title
 * Body: { chatId: string, title: string }
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let body: { chatId?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!body.chatId || !body.title) {
    return new Response(JSON.stringify({ error: 'chatId and title are required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    await gqlClient(locals.token).request(UPDATE_CHAT_TITLE_MUTATION, {
      chatId: body.chatId,
      title: body.title,
    });
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const msg = extractGqlError(e, 'Failed to update title');
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
