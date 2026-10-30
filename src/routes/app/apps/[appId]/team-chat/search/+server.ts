// Team-chat history search for the App page (#1013). One request per page of
// matches; the server owns matching, paging and the read gate, and this handler
// passes the caller's own token and adds no authorization rule of its own.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { searchTeamChat } from '$lib/server/team-chat-search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const q = url.searchParams.get('q');
  // The query is passed UNTRIMMED: the contract counts it as typed. Absent is a
  // client bug; any other length refusal is the server's typed answer.
  if (q === null) return json({ ok: false, code: 'TEAM_CHAT_SEARCH_QUERY_LENGTH' }, { status: 400 });
  const cursor = url.searchParams.get('cursor') || null;
  const result = await searchTeamChat(gqlClient(locals.token), params.appId, q, cursor);
  if (!result.ok) console.warn(`[team-chat] search refused for ${params.appId}: ${result.code}`);
  return json(result);
};
