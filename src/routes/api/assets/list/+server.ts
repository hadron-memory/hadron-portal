import { json } from '@sveltejs/kit';
import { ClientError } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { AGENT_ASSETS_QUERY } from '$lib/server/assetQueries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) {
    return json({ code: 'UNAUTHENTICATED', message: 'sign in required' }, { status: 401 });
  }
  const agentUrn = url.searchParams.get('agentUrn');
  if (!agentUrn) {
    return json({ code: 'INVALID_INPUT', message: 'agentUrn required' }, { status: 400 });
  }
  const skip = url.searchParams.get('skip');
  const count = url.searchParams.get('count');
  const mimeType = url.searchParams.get('mimeType') ?? undefined;
  try {
    const { agentAssets } = await gqlClient(locals.token).request<{
      agentAssets: unknown;
    }>(AGENT_ASSETS_QUERY, {
      agentUrn,
      mimeType,
      skip: skip ? Number(skip) : undefined,
      count: count ? Number(count) : undefined,
    });
    return json(agentAssets);
  } catch (err) {
    if (err instanceof ClientError) {
      const ext = err.response?.errors?.[0]?.extensions as { code?: string } | undefined;
      return json(
        { code: ext?.code ?? 'UNKNOWN', message: err.response?.errors?.[0]?.message ?? 'list failed' },
        { status: 400 },
      );
    }
    return json({ code: 'INTERNAL', message: (err as Error).message }, { status: 500 });
  }
};
