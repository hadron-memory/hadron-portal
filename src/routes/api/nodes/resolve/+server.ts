import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { NODE_REF_QUERY } from '$lib/server/queries';
import type { RequestHandler } from './$types';

// portal#1524: the edge editor's "add target" step used to match a typed loc or
// name against the memory layout's whole node list. The layout no longer loads
// that list, so the target is resolved here instead: ONE per-node read, at
// submit, scoped to the memory (a loc is unique per memory, not globally, #234).
//
// Three answers, and the page treats them differently:
//   200 { found: true,  node }   the node exists
//   200 { found: false }         the server says there is no such node
//   502 { error }                the read failed — NOT "no such node"
export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) return json({ error: 'Unauthorized' }, { status: 401 });
  const memoryId = url.searchParams.get('memoryId')?.trim();
  const ref = url.searchParams.get('ref')?.trim();
  if (!memoryId || !ref) return json({ error: 'memoryId and ref are required' }, { status: 400 });
  try {
    const d = await gqlClient(locals.token).request<{ node: { id: string; loc: string; name: string | null } | null }>(
      NODE_REF_QUERY,
      { ref, memoryRef: memoryId },
    );
    return d.node ? json({ found: true, node: d.node }) : json({ found: false });
  } catch (err) {
    console.warn('[node-resolve] read failed:', err);
    return json({ error: 'Could not look the node up' }, { status: 502 });
  }
};
