import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_REVISION_QUERY } from '$lib/server/queries';
import type { NodeRevision } from '$lib/types';
import type { PageServerLoad } from './$types';

// #529: read-only view of a single NodeRevision snapshot, opened in a new tab
// from the History tab's row menu ("Display"). Access is gated server-side —
// `nodeRevision` returns null when the caller can't read the snapshot's memory.
export const load: PageServerLoad = async ({ params, locals }) => {
  const { nodeRevision } = await gqlClient(locals.token).request<{ nodeRevision: NodeRevision | null }>(
    NODE_REVISION_QUERY,
    { revisionId: params.revisionId },
  );
  if (!nodeRevision) throw error(404, 'Revision not found');
  return { revision: nodeRevision, memoryId: params.id, nodeId: params.nodeId };
};
