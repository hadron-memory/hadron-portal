import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { MOVE_NODE_MUTATION, NODE_BY_ID_QUERY } from '$lib/server/queries';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';
import type { MemoryNode } from '$lib/types';
import type { RequestHandler } from './$types';

// Tree drag-move endpoint (MemoryBrowser). #564 (#501) reshaped moveNode to
// sourceRef + targetUrn, so the body is now { sourceRef, toLoc }: the node's
// PK and the bare destination loc. The endpoint reads the node to compose
// the full destination URN from its own memory — the client never has to
// know the memory urn. Conflicts (NODE_ALREADY_EXISTS) come back as 409
// with the server's message so the drag UI can fail loudly.
export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { sourceRef, toLoc } = await request.json();
  if (!sourceRef || !toLoc) {
    return json({ error: 'sourceRef and toLoc are required' }, { status: 400 });
  }

  const client = gqlClient(locals.token);
  try {
    const { node } = await client.request<{ node: MemoryNode | null }>(NODE_BY_ID_QUERY, { id: String(sourceRef) });
    if (!node) return json({ error: 'Node not found' }, { status: 404 });
    if (!node.memory?.urn) return json({ error: 'Node has no memory URN to move by' }, { status: 500 });

    await client.request(MOVE_NODE_MUTATION, {
      sourceRef: node.id,
      targetUrn: composeNodeUrn(node.memory.urn, String(toLoc)),
    });
    return json({ ok: true });
  } catch (e: unknown) {
    const status = extractGqlErrorCode(e) === 'NODE_ALREADY_EXISTS' ? 409 : 500;
    return json({ error: extractGqlError(e, 'Failed to move node') }, { status });
  }
};
