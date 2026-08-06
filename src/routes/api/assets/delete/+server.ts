import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { SOFT_DELETE_ASSET_MUTATION } from '$lib/server/assetQueries';
import { mapAssetError } from '$lib/server/assetErrors';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.assetId) {
    return json({ code: 'INVALID_INPUT', message: 'assetId required' }, { status: 400 });
  }
  try {
    // Soft delete: the row keeps its storage pointer for a 24h recovery window,
    // after which the janitor (hourly since #888 — before that it had no
    // scheduler at all, so the window never actually expired) purges the bytes.
    await gqlClient(locals.token).request(SOFT_DELETE_ASSET_MUTATION, {
      assetId: body.assetId,
    });
    return json({ ok: true });
  } catch (err) {
    return json(...mapAssetError(err, 'softDeleteAsset'));
  }
};
