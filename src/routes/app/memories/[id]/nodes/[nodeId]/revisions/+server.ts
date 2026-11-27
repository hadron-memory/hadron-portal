import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { includeRefusalOf, includeRefusalText } from '$lib/server/include-refusal';
import {
  RESTORE_NODE_REVISION_MUTATION,
  DELETE_NODE_REVISION_MUTATION,
  CLEAR_NODE_HISTORY_MUTATION,
  UPDATE_NODE_REVISION_MUTATION,
} from '$lib/server/queries';
import type { RequestHandler } from './$types';
import { limitBody, limitRefusal } from '$lib/server/limit-refusal';

// #529: node revision-history write actions (restore / delete / clear), driven
// by the node-detail History tab's row menu + Clear button (#623 rename from
// NodeVersion). GraphQL runs server-side only (token in locals), so the browser
// POSTs here.
//
//   { action: 'restore', revisionId } → restoreNodeRevision(nodeRevRef, truncate:true)
//   { action: 'delete',  revisionId } → deleteNodeRevision(nodeRevRef)
//   { action: 'label',   revisionId, revLabel } → updateNodeRevision (#534; blank clears)
//   { action: 'clear' }               → clearNodeHistory(nodeRef = params.nodeId)
//
// Restore is always truncating here (the History-tab contract: restore the node
// to this revision and drop the newer snapshots).
// The label's length cap is the server's (hrn:node:hadronmemory.com:specs:cor:dmo:060:04 lists it as Tunable):
// nothing here carries the number. updateNodeRevision refuses an over-long
// label BAD_USER_INPUT with its own sentence, and that sentence is what the
// reader sees, as a 400.

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
      await client.request(RESTORE_NODE_REVISION_MUTATION, { nodeRevRef: revisionId, truncate: true });
      return json({ ok: true });
    }
    if (action === 'delete') {
      if (!revisionId) return json({ error: 'revisionId is required.' }, { status: 400 });
      await client.request(DELETE_NODE_REVISION_MUTATION, { nodeRevRef: revisionId });
      return json({ ok: true });
    }
    if (action === 'label') {
      if (!revisionId) return json({ error: 'revisionId is required.' }, { status: 400 });
      if (typeof body?.revLabel !== 'string') return json({ error: 'revLabel must be a string.' }, { status: 400 });
      const revLabel = body.revLabel.trim();
      // A blank label clears it: null, never an empty string the server would store.
      await client.request(UPDATE_NODE_REVISION_MUTATION, { nodeRevRef: revisionId, revLabel: revLabel || null });
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
    const limit = limitRefusal(e);
    if (limit) return json(limitBody(limit), { status: limit.status });
    // portal#1142 S2b: a restore refused for an include tag restored nothing.
    // 409 with the server's words, the tag and a restore-safe next step; the
    // History dialog stays open and shows it.
    const include = action === 'restore' ? includeRefusalOf(e) : null;
    if (include) return json({ error: includeRefusalText(include, 'restore'), code: include.code }, { status: 409 });
    // A refused label is the reader's input, not a fault: the server's own sentence, as a 400.
    if (action === 'label' && extractGqlErrorCode(e) === 'BAD_USER_INPUT') {
      return json({ error: extractGqlError(e, 'The label was refused.') }, { status: 400 });
    }
    console.error('[node-revisions] action failed:', e);
    return json({ error: extractGqlError(e, 'Revision action failed') }, { status: 500 });
  }
};
