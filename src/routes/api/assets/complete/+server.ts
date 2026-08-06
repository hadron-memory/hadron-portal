import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { COMPLETE_ASSET_UPLOAD_MUTATION } from '$lib/server/assetQueries';
import { mapAssetError } from '$lib/server/assetErrors';
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
    // The mutation declares `$input: CompleteAssetUploadInput!` — the uploadId is
    // a FIELD of that input, not a variable of its own. This passed
    // `{ uploadId }` from #182 until portal#696, so `$input` was never provided
    // and EVERY upload failed at the final step. The #681 caller gate could not
    // see it: its file pre-filter matched the literal `.request(` and so skipped
    // every file that annotates the response type inline, this one included.
    const { completeAssetUpload } = await gqlClient(locals.token).request<{
      completeAssetUpload: unknown;
    }>(COMPLETE_ASSET_UPLOAD_MUTATION, { input: { uploadId: body.uploadId } });
    return json(completeAssetUpload);
  } catch (err) {
    return json(...mapAssetError(err, 'completeAssetUpload'));
  }
};
