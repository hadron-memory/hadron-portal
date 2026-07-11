import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_VERSION_QUERY } from '$lib/server/queries';
import type { NodeVersion } from '$lib/types';
import type { PageServerLoad } from './$types';

// #529: read-only view of a single NodeVersion snapshot, opened in a new tab
// from the History tab's row menu ("Display"). Access is gated server-side —
// `nodeVersion` returns null when the caller can't read the snapshot's memory.
export const load: PageServerLoad = async ({ params, locals }) => {
  const { nodeVersion } = await gqlClient(locals.token).request<{ nodeVersion: NodeVersion | null }>(
    NODE_VERSION_QUERY,
    { versionId: params.versionId },
  );
  if (!nodeVersion) throw error(404, 'Version not found');
  return { version: nodeVersion, memoryId: params.id, nodeId: params.nodeId };
};
