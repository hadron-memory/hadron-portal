import { AGENT_CHAT_PAGE_SIZE } from '$lib/agent-chat-window';
import { loadAgentChatPage } from '$lib/server/agent-chat';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import type { RequestHandler } from './$types';

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * POST /api/agent-chat/older
 * Body: { chatId: string, beforeSeq: number }
 *
 * #793 — the page BEFORE the loaded window, for scrolling up an agent chat.
 *
 * A sibling of `/resume` rather than a mode of it, per the rule #785 left
 * behind: a scroll-up is a background read triggered by a scrollbar, and it
 * must not be able to re-run the paths that build the surface. `/resume` also
 * fetches chat metadata and 404s when the chat is missing from `myChats` — an
 * outcome that is correct when opening a chat and destructive when the reader is
 * merely scrolling, since the component clears `activeChatId` on a resume
 * failure. This endpoint reads the transcript and nothing else.
 *
 * Entitlement is not re-checked here because it is not this route's to check:
 * `chatHistory` authorizes every read against the caller's token
 * (`resolvers.query.chat.ts` — impersonation refused, chat narrowed to the
 * caller's entitled set BEFORE one is picked, then a read-visibility check).
 * Re-implementing a weaker version of that here is how the two drift apart.
 */
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, 401);

  let body: { chatId?: string; beforeSeq?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!body.chatId) return json({ error: 'chatId is required' }, 400);

  // `Number.isSafeInteger` and not a truthiness check: `seq` starts at 0 in
  // principle, and `!0` would reject the one cursor that reaches the very first
  // message. It also rejects the strings and NaN a hand-built request can carry
  // into a GraphQL `Int` variable, which fails as a query error rather than a
  // 400 the client can read.
  const beforeSeq = body.beforeSeq;
  if (!Number.isSafeInteger(beforeSeq)) {
    return json({ error: 'beforeSeq must be an integer' }, 400);
  }

  try {
    const page = await loadAgentChatPage(
      gqlClient(locals.token),
      body.chatId,
      beforeSeq as number,
      AGENT_CHAT_PAGE_SIZE,
    );
    return json({ messages: page.messages, hasOlder: page.hasOlder });
  } catch (e) {
    return json({ error: extractGqlError(e, 'Failed to load older messages') }, 500);
  }
};
