import { json } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { COMPLETE_ASSET_UPLOAD_MUTATION } from '$lib/server/assetQueries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  if (!body.uploadId) {
    return json({ code: 'INVALID_INPUT', message: 'uploadId required' }, { status: 400 });
  }
  try {
    const { completeAssetUpload } = await gqlClient(locals.token).request<{
      completeAssetUpload: unknown;
    }>(COMPLETE_ASSET_UPLOAD_MUTATION, { uploadId: body.uploadId });
    return json(completeAssetUpload);
  } catch (err) {
    if (err instanceof ClientError) {
      const ext = err.response?.errors?.[0]?.extensions as { code?: string } | undefined;
      const message = err.response?.errors?.[0]?.message ?? 'complete failed';
      return json({ code: ext?.code ?? 'UNKNOWN', message }, { status: 400 });
    }
    return json({ code: 'INTERNAL', message: (err as Error).message }, { status: 500 });
  }
};
