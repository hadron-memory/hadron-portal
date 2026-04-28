import { json } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { SOFT_DELETE_ASSET_MUTATION } from '$lib/server/assetQueries';
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
    await gqlClient(locals.token).request(SOFT_DELETE_ASSET_MUTATION, {
      assetId: body.assetId,
    });
    return json({ ok: true });
  } catch (err) {
    if (err instanceof ClientError) {
      const ext = err.response?.errors?.[0]?.extensions as { code?: string } | undefined;
      return json(
        { code: ext?.code ?? 'UNKNOWN', message: err.response?.errors?.[0]?.message ?? 'delete failed' },
        { status: ext?.code === 'NOT_FOUND' ? 404 : 400 },
      );
    }
    return json({ code: 'INTERNAL', message: (err as Error).message }, { status: 500 });
  }
};
