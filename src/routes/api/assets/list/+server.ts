import { json } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { MEMORY_ASSETS_QUERY } from '$lib/server/assetQueries';
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
  try {
    const { memoryAssets } = await gqlClient(locals.token).request<{
      memoryAssets: unknown;
    }>(MEMORY_ASSETS_QUERY, {
      memoryId,
      mimeType,
      skip: skip ? Number(skip) : undefined,
      count: count ? Number(count) : undefined,
    });
    return json(memoryAssets);
  } catch (err) {
    if (err instanceof ClientError) {
      const ext = err.response?.errors?.[0]?.extensions as { code?: string } | undefined;
      return json(
        { code: ext?.code ?? 'UNKNOWN', message: err.response?.errors?.[0]?.message ?? 'list failed' },
        { status: ext?.code === 'NOT_FOUND' ? 404 : ext?.code === 'PERMISSION_DENIED' ? 403 : 400 },
      );
    }
    return json({ code: 'INTERNAL', message: (err as Error).message }, { status: 500 });
  }
};
