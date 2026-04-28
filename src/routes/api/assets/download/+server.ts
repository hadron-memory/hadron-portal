import { json } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { ASSET_DOWNLOAD_URL_QUERY } from '$lib/server/assetQueries';
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
    const { assetDownloadUrl } = await gqlClient(locals.token).request<{
      assetDownloadUrl: { url: string; expiresAt: string };
    }>(ASSET_DOWNLOAD_URL_QUERY, { assetId });
    return json(assetDownloadUrl);
  } catch (err) {
    if (err instanceof ClientError) {
      const ext = err.response?.errors?.[0]?.extensions as { code?: string } | undefined;
      const message = err.response?.errors?.[0]?.message ?? 'download url failed';
      const status = ext?.code === 'NOT_FOUND' ? 404
        : ext?.code === 'SCAN_PENDING' || ext?.code === 'SCAN_BLOCKED' ? 409
        : ext?.code === 'PERMISSION_DENIED' ? 403
        : 400;
      return json({ code: ext?.code ?? 'UNKNOWN', message }, { status });
    }
    return json({ code: 'INTERNAL', message: (err as Error).message }, { status: 500 });
  }
};
