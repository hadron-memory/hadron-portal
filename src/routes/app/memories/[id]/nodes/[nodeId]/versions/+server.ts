import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import {
  RESTORE_NODE_VERSION_MUTATION,
  DELETE_NODE_VERSION_MUTATION,
  CLEAR_NODE_HISTORY_MUTATION,
} from '$lib/server/queries';
import type { RequestHandler } from './$types';

// #529: node version-history write actions (restore / delete / clear), driven by
// the node-detail History tab's row menu + Clear button. GraphQL runs
// server-side only (token in locals), so the browser POSTs here.
//
//   { action: 'restore', versionId }  → restoreNodeVersion(versionId, truncate:true)
//   { action: 'delete',  versionId }  → deleteNodeVersion(versionId)
//   { action: 'clear' }               → clearNodeHistory(nodeRef = params.nodeId)
//
// Restore is always truncating here (the History-tab contract: restore the node
// to this version and drop the newer snapshots).
export const POST: RequestHandler = async ({ params, request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const action = body?.action;
  const versionId = typeof body?.versionId === 'string' ? body.versionId : '';
  const client = gqlClient(locals.token);

  try {
    if (action === 'restore') {
      if (!versionId) return json({ error: 'versionId is required.' }, { status: 400 });
      await client.request(RESTORE_NODE_VERSION_MUTATION, { versionId, truncate: true });
      return json({ ok: true });
    }
    if (action === 'delete') {
      if (!versionId) return json({ error: 'versionId is required.' }, { status: 400 });
      await client.request(DELETE_NODE_VERSION_MUTATION, { versionId });
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
    console.error('[node-versions] action failed:', e);
    return json({ error: extractGqlError(e, 'Version action failed') }, { status: 500 });
  }
};
