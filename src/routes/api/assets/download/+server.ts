import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { ASSET_DOWNLOAD_URL_QUERY } from '$lib/server/assetQueries';
import { mapAssetError } from '$lib/server/assetErrors';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }
  const assetId = url.searchParams.get('assetId');
  if (!assetId) {
    return json({ code: 'INVALID_INPUT', message: 'assetId required' }, { status: 400 });
  }
  try {
    // Short-TTL presigned GET, gated server-side on the holding memory's read
    // access and a CLEAN scan. Since #888 it is no longer uploader-scoped: a
    // co-member can download a colleague's file, and a run-created asset
    // (uploadedBy NULL) is reachable at all.
    const { assetDownloadUrl } = await gqlClient(locals.token).request<{
      assetDownloadUrl: { url: string; expiresAt: string };
    }>(ASSET_DOWNLOAD_URL_QUERY, { assetId });
    return json(assetDownloadUrl);
  } catch (err) {
    return json(...mapAssetError(err, 'assetDownloadUrl'));
  }
};
