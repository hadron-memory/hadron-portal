import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MOVE_NODE_MUTATION } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { from, to, memoryId } = await request.json();
  if (!from || !to || !memoryId) {
    return json({ error: 'from, to, and memoryId are required' }, { status: 400 });
  }

  try {
    await gqlClient(locals.token).request(MOVE_NODE_MUTATION, { from, to, memoryId });
    return json({ ok: true });
  } catch (e: unknown) {
    return json({ error: e instanceof Error ? e.message : 'Failed to move node' }, { status: 500 });
  }
};
