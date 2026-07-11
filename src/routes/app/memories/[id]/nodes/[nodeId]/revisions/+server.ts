import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import {
  RESTORE_NODE_REVISION_MUTATION,
  DELETE_NODE_REVISION_MUTATION,
  CLEAR_NODE_HISTORY_MUTATION,
} from '$lib/server/queries';
import type { RequestHandler } from './$types';

// #529: node revision-history write actions (restore / delete / clear), driven
// by the node-detail History tab's row menu + Clear button (#623 rename from
// NodeVersion). GraphQL runs server-side only (token in locals), so the browser
// POSTs here.
//
//   { action: 'restore', revisionId } → restoreNodeRevision(revisionId, truncate:true)
//   { action: 'delete',  revisionId } → deleteNodeRevision(revisionId)
//   { action: 'clear' }               → clearNodeHistory(nodeRef = params.nodeId)
//
// Restore is always truncating here (the History-tab contract: restore the node
// to this revision and drop the newer snapshots).
export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  const revisionId = typeof body?.revisionId === 'string' ? body.revisionId : '';
  const client = gqlClient(locals.token);

  try {
    if (action === 'restore') {
      if (!revisionId) return json({ error: 'revisionId is required.' }, { status: 400 });
      await client.request(RESTORE_NODE_REVISION_MUTATION, { revisionId, truncate: true });
      return json({ ok: true });
    }
    if (action === 'delete') {
      if (!revisionId) return json({ error: 'revisionId is required.' }, { status: 400 });
      await client.request(DELETE_NODE_REVISION_MUTATION, { revisionId });
      return json({ ok: true });
    }
    if (action === 'clear') {
      const res = await client.request<{ clearNodeHistory: number }>(CLEAR_NODE_HISTORY_MUTATION, {
        nodeRef: params.nodeId,
      });
      return json({ ok: true, cleared: res.clearNodeHistory });
    }
    return json({ error: 'Unknown action.' }, { status: 400 });
  } catch (e: unknown) {
    console.error('[node-revisions] action failed:', e);
    return json({ error: extractGqlError(e, 'Revision action failed') }, { status: 500 });
  }
};
