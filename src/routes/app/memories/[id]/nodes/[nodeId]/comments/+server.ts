import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadDiscussion, parseCommentWrite, readCommentHead, sendCommentWrite } from '$lib/server/comments';
import { t } from '$lib/i18n/t';
import type { RequestHandler } from './$types';

// portal#1014: the Discussion tab's endpoint, posted to like /mint.
//
// GET  → the node's threads, the reader's permissions and the open-feedback
//        summary, so the tab can refresh without reloading the page.
// POST → one comment write ({ op, … }), answered with the fresh discussion,
//        so the tab never shows a write it can't confirm landed.
//
// Both check that the node lives in the memory the URL names (the loader's
// rule): a comment endpoint reachable under any memory id would let a stale
// or crafted link write somewhere the page never showed.

const failedReadText = () => t('comments.read-failed', "Couldn't load the discussion. Reload to try again.");

/** A page offset from the query string: a nonnegative integer, else the first page. */
function offsetParam(url: URL): number {
  const raw = url.searchParams.get('offset');
  const n = raw === null ? 0 : Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, { status: 401 });
  const client = gqlClient(locals.token);
  let head;
  try {
    head = await readCommentHead(client, params.nodeId);
  } catch (e) {
    console.warn('[comments] head read failed:', e);
    return json({ error: failedReadText() }, { status: 502 });
  }
  if (!head || head.memory?.id !== params.id) return json({ error: 'Not found' }, { status: 404 });
  const discussion = await loadDiscussion(
    client,
    head.id,
    { userId: locals.user?.id, memoryUrn: head.memory.urn, impersonating: locals.impersonation != null },
    offsetParam(url),
  );
  if (!discussion.ok) return json({ error: failedReadText() }, { status: 502 });
  return json({ discussion, summary: head.commentSummary, revision: head.revision });
};

export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, { status: 401 });
  const write = parseCommentWrite(await request.json().catch(() => null));
  if (!write) return json({ error: t('comments.bad-request', "That request wasn't understood, so nothing was changed.") }, { status: 400 });
  const client = gqlClient(locals.token);
  let head;
  try {
    head = await readCommentHead(client, params.nodeId);
  } catch (e) {
    // Nothing was sent yet, so nothing changed.
    console.warn('[comments] head read failed:', e);
    return json({ error: failedReadText() }, { status: 502 });
  }
  if (!head || head.memory?.id !== params.id) return json({ error: 'Not found' }, { status: 404 });

  const result = await sendCommentWrite(client, head.id, write);
  // Refresh either way: after a refusal the reader sees the state that caused
  // it (a thread someone else just resolved), and after an unknown outcome the
  // fresh read is how they find out whether it landed.
  const [discussion, after] = await Promise.all([
    loadDiscussion(client, head.id, {
      userId: locals.user?.id,
      memoryUrn: head.memory.urn,
      impersonating: locals.impersonation != null,
    }),
    readCommentHead(client, head.id).catch(() => null),
  ]);
  const fresh = {
    ...(discussion.ok ? { discussion } : {}),
    ...(after ? { summary: after.commentSummary } : {}),
  };
  if (!result.ok) return json({ error: result.text, code: result.code, ...fresh }, { status: result.status });
  return json({ ok: true, ...fresh });
};
