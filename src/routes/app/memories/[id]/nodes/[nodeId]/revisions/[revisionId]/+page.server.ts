import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  NODE_LIVE_CONTENT_QUERY,
  NODE_REVISION_PROVENANCE_QUERY,
  NODE_REVISION_QUERY,
  NODE_REVISIONS_QUERY,
} from '$lib/server/queries';
import { diffRevisionContent, replacementOf, type ContentDiff } from '$lib/revision-diff';
import type { NodeProvenance, ProvenanceResult } from '$lib/node-provenance';
import type { NodeRevision } from '$lib/types';
import type { PageServerLoad } from './$types';

/**
 * #1001: what the edit that replaced this snapshot changed. `ok: false` means
 * "couldn't load"; `against: 'unknown'` means we looked and this snapshot is not
 * in the History list, so no honest single-edit diff exists.
 */
export type RevisionChanges =
  | { ok: false }
  | { ok: true; against: 'unknown' }
  | ({ ok: true; against: 'current' | 'revision' } & ContentDiff);

// #529: read-only view of a single NodeRevision snapshot, opened in a new tab
// from the History tab's row menu ("Display"). Access is gated server-side —
// `nodeRevision` returns null when the caller can't read the snapshot's memory.
export const load: PageServerLoad = async ({ params, locals }) => {
  const { nodeRevision } = await gqlClient(locals.token).request<{ nodeRevision: NodeRevision | null }>(
    NODE_REVISION_QUERY,
    { nodeRevRef: params.revisionId },
  );
  if (!nodeRevision) throw error(404, 'Revision not found');
  // #914: the snapshot's own authorship + validation, streamed and isolated
  // (see NODE_PROVENANCE_QUERY). A failure says "couldn't load" on the page.
  const provenance = (async (): Promise<ProvenanceResult<NodeProvenance>> => {
    try {
      const r = await gqlClient(locals.token).request<{ nodeRevision: NodeProvenance | null }>(
        NODE_REVISION_PROVENANCE_QUERY,
        { nodeRevRef: params.revisionId },
      );
      return r?.nodeRevision ? { ok: true, value: r.nodeRevision } : { ok: false };
    } catch (e) {
      console.warn('[node-revision] provenance failed:', e);
      return { ok: false };
    }
  })();
  // #1001: a NodeRevision is the PRE-edit snapshot, so the change is the diff
  // to the next-newer snapshot (or the live node for the newest). Streamed and
  // isolated like provenance: a failure here costs only the Changes section.
  const changes = (async (): Promise<RevisionChanges> => {
    try {
      const client = gqlClient(locals.token);
      const { nodeRevisions } = await client.request<{ nodeRevisions: NodeRevision[] }>(
        NODE_REVISIONS_QUERY,
        { nodeRef: params.nodeId, limit: 100 },
      );
      const next = replacementOf(nodeRevisions ?? [], params.revisionId);
      if (next.kind === 'unknown') return { ok: true, against: 'unknown' };
      if (next.kind === 'current') {
        const live = await client.request<{ node: { content: string | null; revision: number | null } | null }>(
          NODE_LIVE_CONTENT_QUERY,
          { ref: params.nodeId },
        );
        if (!live?.node) return { ok: false };
        // The newest readable snapshot only precedes the live node if no
        // snapshot sits between them (filtered, pruned, or a truncating restore).
        if (live.node.revision !== next.liveRevision) return { ok: true, against: 'unknown' };
        return { ok: true, against: 'current', ...diffRevisionContent(nodeRevision.content, live.node.content) };
      }
      const newer = await client.request<{ nodeRevision: NodeRevision | null }>(NODE_REVISION_QUERY, {
        nodeRevRef: next.id,
      });
      if (!newer?.nodeRevision) return { ok: false };
      return {
        ok: true,
        against: 'revision',
        ...diffRevisionContent(nodeRevision.content, newer.nodeRevision.content),
      };
    } catch (e) {
      console.warn('[node-revision] changes failed:', e);
      return { ok: false };
    }
  })();
  return { revision: nodeRevision, provenance, changes, memoryId: params.id, nodeId: params.nodeId };
};
