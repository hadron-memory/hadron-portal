import { gqlClient } from '$lib/server/api';
import { findAgentChat } from '$lib/server/agent-chat-metadata';
import { readServedPrompts, type ServedPromptRead } from '$lib/server/served-prompts';
import { SERVED_RECORD_PAGE, type ServedPromptSource } from '$lib/served-prompts';
import type { RequestHandler } from './$types';

/**
 * GET /api/served-prompts?source=worker|session|run|chat&ref=<id>[&agentId&chatId][&offset][&provOffset][&lintAfter]
 *
 * portal#1665. One read-only door for the served-record views. The provider already conceals what the
 * viewer may not read (an empty page or null), so an empty answer here means "nothing you may read",
 * never "no record". A real failure is a non-2xx with one fixed message, never an empty list.
 *
 * A chat is addressed by `{agentId, chatId}` (the loc the panel already holds), found in the viewer's OWN
 * `myChats` list; only that row's id reaches `chatServedPrompts`. A browser-supplied id never does.
 */
const SOURCES: readonly ServedPromptSource[] = ['worker', 'session', 'run', 'chat'];
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
/** 1..SERVED_RECORD_PAGE records; the nested pagers ask for exactly one so they never re-page its siblings. */
const pageLimit = (v: string | null) => (v !== null && /^[1-9]$/.test(v) ? Math.min(Number(v), SERVED_RECORD_PAGE) : SERVED_RECORD_PAGE);
const nonNegativeInt = (v: string | null) => (v !== null && /^\d{1,9}$/.test(v) ? Number(v) : 0);

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, 401);
  const source = url.searchParams.get('source') as ServedPromptSource | null;
  if (!source || !SOURCES.includes(source)) return json({ error: 'source must be worker, session, run or chat' }, 400);

  const client = gqlClient(locals.token);
  let read: ServedPromptRead;
  if (source === 'chat') {
    const agentId = url.searchParams.get('agentId');
    const chatId = url.searchParams.get('chatId');
    if (!agentId || !chatId) return json({ error: 'agentId and chatId are required' }, 400);
    let chat;
    try {
      chat = await findAgentChat(client, agentId, chatId);
    } catch (e) {
      console.warn('[served-prompts] chat list read failed:', e);
      return json({ error: "Couldn't load the served prompt." }, 502);
    }
    // Not in the viewer's own list: 404 and no served-prompt read.
    if (!chat) return json({ error: 'Chat not found' }, 404);
    read = { source, ref: chat.id };
  } else {
    const ref = url.searchParams.get('ref');
    if (!ref) return json({ error: 'ref is required' }, 400);
    read = { source, ref };
  }

  try {
    const page = await readServedPrompts(client, read, {
      limit: pageLimit(url.searchParams.get('limit')),
      offset: nonNegativeInt(url.searchParams.get('offset')),
      provenanceOffset: nonNegativeInt(url.searchParams.get('provOffset')),
      lintAfter: url.searchParams.get('lintAfter') || null,
    });
    return json(page, 200);
  } catch (e) {
    console.warn(`[served-prompts] ${source} read failed:`, e);
    return json({ error: "Couldn't load the served prompt." }, 502);
  }
};
