import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { MEMORY_ASSETS_QUERY } from '$lib/server/assetQueries';
import { mapAssetError } from '$lib/server/assetErrors';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }
  // v2 (spec 006): memoryId replaces agentUrn as the listing key.
  const memoryId = url.searchParams.get('memoryId');
  if (!memoryId) {
    return json({ code: 'INVALID_INPUT', message: 'memoryId required' }, { status: 400 });
  }
  const skip = url.searchParams.get('skip');
  const count = url.searchParams.get('count');
  const mimeType = url.searchParams.get('mimeType') ?? undefined;
  // #888: `mine` narrows to the caller's own uploads — a filter on top of the
  // memory read gate. Presence-only: anything but the literal 'true' reads as
  // unset rather than as a parse error, matching the client helper, which only
  // sends the param when narrowing.
  const mine = url.searchParams.get('mine') === 'true' ? true : undefined;
  try {
    const { memoryAssets } = await gqlClient(locals.token).request<{
      memoryAssets: unknown;
    }>(MEMORY_ASSETS_QUERY, {
      memoryId,
      mimeType,
      skip: skip ? Number(skip) : undefined,
      count: count ? Number(count) : undefined,
      mine,
    });
    return json(memoryAssets);
  } catch (err) {
    return json(...mapAssetError(err, 'memoryAssets'));
  }
};
