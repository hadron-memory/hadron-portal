import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_REVISION_QUERY, NODE_REVISION_PROVENANCE_QUERY } from '$lib/server/queries';
import type { NodeProvenance, ProvenanceResult } from '$lib/node-provenance';
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
  // #914: the snapshot's own authorship + validation, streamed and isolated
  // (see NODE_PROVENANCE_QUERY). A failure says "couldn't load" on the page.
  const provenance = (async (): Promise<ProvenanceResult<NodeProvenance>> => {
    try {
      const r = await gqlClient(locals.token).request<{ nodeRevision: NodeProvenance | null }>(
        NODE_REVISION_PROVENANCE_QUERY,
        { revisionId: params.revisionId },
      );
      return r?.nodeRevision ? { ok: true, value: r.nodeRevision } : { ok: false };
    } catch (e) {
      console.warn('[node-revision] provenance failed:', e);
      return { ok: false };
    }
  })();
  return { revision: nodeRevision, provenance, memoryId: params.id, nodeId: params.nodeId };
};
