import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_COLUMNS_NO_SIGNING_QUERY, NODE_COLUMNS_QUERY } from '$lib/server/queries';
import { deploymentOffersSigning } from '$lib/server/signing-capability';
import { COLUMN_BATCH, type ColumnActor, type NodeColumnRow } from '$lib/node-columns';
import type { RequestHandler } from './$types';

// portal#1174: the Nodes tab's extra columns for a batch of node ids. Browser →
// this endpoint → hadron-server's `nodeBatch`; GraphQL only runs server-side
// (the token lives in locals), the same shape as /api/nodes/search. The caller
// pages its ids in batches of at most COLUMN_BATCH, the server's own cap, which
// refuses a bigger list rather than truncating it.

type Actor = { id: string; name: string; urn: string | null } | null;
type BatchNode = {
  id: string;
  role: string | null;
  updatedAt: string | null;
  revision: number | null;
  approvalStatus: { state: string } | null;
  signatureStatus?: { state: string | null } | null;
  updatedByAgent: Actor;
  updatedByWorker: Actor;
};
type BatchResp = {
  nodeBatch: { nodes: BatchNode[]; unavailable: string[]; omitted: string[]; truncated: boolean };
};

const actor = (a: Actor): ColumnActor | null => (a ? { id: a.id, name: a.name, urn: a.urn ?? null } : null);

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, { status: 401 });

  const { refs } = (await request.json()) as { refs?: unknown };
  if (
    !Array.isArray(refs) ||
    refs.length === 0 ||
    refs.length > COLUMN_BATCH ||
    !refs.every((r) => typeof r === 'string' && r !== '')
  ) {
    return json({ error: `refs must be 1 to ${COLUMN_BATCH} node ids` }, { status: 400 });
  }

  try {
    // Signing is a deployment switch; while it is off the signature field does
    // not exist and selecting it would fail the whole batch.
    const signing = await deploymentOffersSigning(locals.token);
    const { nodeBatch } = await gqlClient(locals.token).request<BatchResp>(
      signing ? NODE_COLUMNS_QUERY : NODE_COLUMNS_NO_SIGNING_QUERY,
      { refs },
    );
    const rows: NodeColumnRow[] = (nodeBatch?.nodes ?? []).map((n) => ({
      id: n.id,
      role: n.role ?? null,
      updatedAt: n.updatedAt ?? null,
      revision: n.revision ?? null,
      approval: (n.approvalStatus?.state as NodeColumnRow['approval']) ?? null,
      signature: n.signatureStatus?.state ?? null,
      agent: actor(n.updatedByAgent),
      worker: actor(n.updatedByWorker),
    }));
    return json({ rows, unavailable: nodeBatch?.unavailable ?? [], omitted: nodeBatch?.omitted ?? [], signing });
  } catch (e: unknown) {
    // Log detail server-side; the client gets a generic message so query shapes
    // and server state are not leaked (the same rule as /api/nodes/search).
    console.error('[/api/nodes/columns] failed:', e);
    return json({ error: 'Could not load the node columns' }, { status: 500 });
  }
};
