import { error, json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { nodeChoices } from '$lib/server/node-choices';
import type { RequestHandler } from './$types';

/**
 * portal#1576 — the node picker's choices, scoped to one memory and read with
 * the VIEWER's token (locals.token), exactly like the task picker's
 * `tasks/choices`. The server is the authority on what the viewer may read;
 * this endpoint passes its answer through.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const client = gqlClient(locals.token);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) error(400, 'Invalid offset');
  const query = url.searchParams.get('query')?.trim() || undefined;
  return json(await nodeChoices(client, params.id, offset, query), { headers: { 'cache-control': 'no-store' } });
};
