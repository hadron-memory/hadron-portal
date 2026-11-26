import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { BEGIN_ASSET_UPLOAD_V2_MUTATION } from '$lib/server/assetQueries';
import { mapAssetError } from '$lib/server/assetErrors';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  // v2 (spec 006): memoryId replaces agentUrn as the addressing key.
  const required = ['memoryId', 'filename', 'mimeType', 'sizeBytes', 'uploadIntent'];
  for (const k of required) {
    if (body[k] == null) {
      return json({ code: 'INVALID_INPUT', message: `${k} required` }, { status: 400 });
    }
  }

  // The browser keeps sending `memoryId` (the portal's own contract); the server's input names it
  // `memoryRef` since hadron-server#5080. Built key by key, so no other browser key reaches the
  // server unchecked and a rename on either side is caught here and by gql:validate.
  const input = {
    memoryRef: body.memoryId,
    filename: body.filename,
    mimeType: body.mimeType,
    sizeBytes: body.sizeBytes,
    description: body.description,
    uploadIntent: body.uploadIntent,
    uploadRequestId: body.uploadRequestId,
  };

  try {
    const { beginAssetUploadV2 } = await gqlClient(locals.token).request<{
      beginAssetUploadV2: unknown;
    }>(BEGIN_ASSET_UPLOAD_V2_MUTATION, { input });
    return json(beginAssetUploadV2);
  } catch (err) {
    return json(...mapAssetError(err, 'beginAssetUploadV2'));
  }
};
