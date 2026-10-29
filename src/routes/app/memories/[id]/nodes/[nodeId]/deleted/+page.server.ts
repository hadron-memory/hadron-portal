import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { RECOVERY_NODE_QUERY, RESTORE_NODE_MUTATION } from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

/**
 * #1159 — a retained, soft-deleted node. `node(ref:)` never resolves it, so the
 * live node page hands over here when `recoveryNode` finds a tombstone the
 * viewer may recover. The read is writer-only and null otherwise, which keeps
 * the same 404 for "missing" and "not yours".
 */
export const load: PageServerLoad = async ({ params, locals, parent }) => {
  const [parentData, data] = await Promise.all([
    parent(),
    gqlClient(locals.token).request<{ recoveryNode: DeletedNode | null }>(
      RECOVERY_NODE_QUERY, { nodeRef: params.nodeId },
    ),
  ]);
  await requireNonConsumer(async () => parentData);
  const node = data.recoveryNode;
  // A tombstone under another memory's URL is not shown under this one.
  if (!node || node.memoryId !== params.id) throw error(404, 'Node not found');
  return { node };
};

export const actions: Actions = {
  restore: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(RESTORE_NODE_MUTATION, { nodeRef: params.nodeId });
    } catch (e: unknown) {
      // The server's own refusal says what to do first (e.g. restore a deleted
      // ancestor), so it is shown as-is rather than paraphrased.
      return fail(409, { error: extractGqlError(e, 'Failed to restore', ["CONFLICT"]) });
    }
    redirect(303, `/app/memories/${params.id}/nodes/${params.nodeId}`);
  },
};

export interface DeletedNode {
  id: string;
  urn: string;
  memoryId: string;
  loc: string;
  name: string;
  nodeType: string;
  description: string | null;
  deletedAt: string;
  content: string | null;
}
