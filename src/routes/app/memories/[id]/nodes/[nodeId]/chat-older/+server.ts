// #793: the previous page of a chat transcript, as an isolated read.
//
// Follows the convention `team-chat/+server.ts` established for the poll (#785)
// and for the same reason: a scroll-up must not be able to re-run the node
// page's load, whose failure paths are FATAL. A reader paging back through
// history is not asking to navigate, and a transient blip on an unrelated query
// must not replace the page they are reading with an error.
//
// Access control is the GraphQL query's, exactly as it is for the page load —
// `findNodes` is memory-gated server-side and this handler passes the caller's
// own token. There is deliberately no portal-side gate re-implemented here: a
// second copy of an authorization rule is drift, and the weaker copy wins.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_BY_ID_QUERY } from '$lib/server/queries';
import { chatSortKey, isChatNode, legacyThreadEvidence, loadChatMessages } from '$lib/server/team-chat';
import type { MemoryNode } from '$lib/types';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params, url, locals }) => {
  const before = Number(url.searchParams.get('before'));
  // A missing or malformed cursor is a client bug, not an empty thread. Refuse
  // it loudly rather than defaulting to the tail, which would silently re-serve
  // the page the reader already has and read as "no more history".
  if (!Number.isFinite(before) || before <= 0) {
    return json({ messages: [], loadFailed: true, reason: 'bad-cursor' }, { status: 400 });
  }

  try {
    const client = gqlClient(locals.token);
    // The node is re-read rather than trusted from the URL: `loadChatMessages`
    // needs the chat's loc, and a stale tab could name a node that has since
    // moved or stopped being a chat. Same reasoning as the post action's #237
    // guard — the URL is a hint, the node is the fact.
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, {
      ref: params.nodeId,
    });
    if (!node || node.memoryId !== params.id || !isChatNode(node, await legacyThreadEvidence(client, node))) {
      return json({ messages: [], loadFailed: true, reason: 'not-a-chat' }, { status: 404 });
    }

    const page = await loadChatMessages(client, params.id, node.loc, { before, sort: chatSortKey(node) });
    return json({
      messages: page.messages,
      hasOlder: page.hasOlder,
      offset: page.offset,
      loadFailed: false,
    });
  } catch (e) {
    // 200 with a flag, not a 5xx: this feeds a background scroll. The thread the
    // reader is looking at is still good — they simply did not get the older
    // page — and the component distinguishes a FAILED fetch from an EXHAUSTED
    // one, so returning an empty list here would permanently stop the scrollback
    // on one transient error.
    console.warn(`[chat-older] failed for ${params.nodeId}:`, e);
    return json({ messages: [], loadFailed: true, reason: 'fetch-failed' }, { status: 200 });
  }
};
