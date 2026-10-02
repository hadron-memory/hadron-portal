import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { APPROVE_MEMORY_NODES_MUTATION } from '$lib/server/queries';
import { approveAllFailure, type ApproveMemoryNodesResult } from '$lib/memory-approval';
import type { RequestHandler } from './$types';

// #992: "Approve all" from the memory actions menu. A thin pass-through to
// approveMemoryNodes, posted to like /clone (GraphQL runs server-side only).
// The mutation is all-or-nothing, so a failure means nothing was approved.
export const POST: RequestHandler = async ({ params, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const res = await gqlClient(locals.token).request<{ approveMemoryNodes: ApproveMemoryNodesResult }>(
      APPROVE_MEMORY_NODES_MUTATION,
      { memoryRef: params.id },
    );
    const { approvedCount, alreadyApprovedCount, skippedPlaceholders } = res.approveMemoryNodes;
    return json({ result: { approvedCount, alreadyApprovedCount, skippedPlaceholders } });
  } catch (e: unknown) {
    const { status, text } = approveAllFailure(extractGqlErrorCode(e));
    if (status === 500) console.error('[memories/approve-all] failed:', e);
    return json({ error: text }, { status });
  }
};
