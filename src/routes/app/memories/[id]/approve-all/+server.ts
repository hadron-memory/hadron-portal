import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { APPROVE_MEMORY_NODES_MUTATION } from '$lib/server/queries';
import { approveAllFailure, type ApproveMemoryNodesResult } from '$lib/memory-approval';
import type { RequestHandler } from './$types';

// #992: "Approve all" from the memory actions menu. A thin pass-through to
// approveMemoryNodes, posted to like /clone (GraphQL runs server-side only).
// The mutation is all-or-nothing, so a failure means nothing was approved.
type ServerResult = Omit<ApproveMemoryNodesResult, 'openFeedback'> & {
  // Null-tolerant: a warning field must never turn a succeeded approval into
  // failure copy (local review on #1025, P2).
  unresolvedFeedback?: Array<{ urn: string; openThreads: number }> | null;
};

export const POST: RequestHandler = async ({ params, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const res = await gqlClient(locals.token).request<{ approveMemoryNodes: ServerResult }>(
      APPROVE_MEMORY_NODES_MUTATION,
      { memoryRef: params.id },
    );
    const { approvedCount, alreadyApprovedCount, skippedPlaceholders, unresolvedFeedback } = res.approveMemoryNodes;
    const result: ApproveMemoryNodesResult = {
      approvedCount,
      alreadyApprovedCount,
      skippedPlaceholders,
      openFeedback: (unresolvedFeedback ?? []).map(({ urn, openThreads }) => ({ urn, openThreads })),
    };
    return json({ result });
  } catch (e: unknown) {
    const { status, text } = approveAllFailure(extractGqlErrorCode(e));
    if (status === 500) console.error('[memories/approve-all] failed:', e);
    return json({ error: text }, { status });
  }
};
