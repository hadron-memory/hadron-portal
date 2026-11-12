import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { readCustomisation } from '$lib/server/install-customisation';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ params, locals, url }) => {
  const raw = url.searchParams.get('offset') ?? '0';
  const offset = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 2147483647)
    return json({
      list: { state: 'failed' },
      replacement: { state: 'not-shown' },
      original: { state: 'not-shown' },
    });
  return json(
    await readCustomisation(
      gqlClient(locals.token),
      { appRef: params.appId, agentRef: url.searchParams.get('agent') ?? '' },
      offset,
      url.searchParams.get('loc') ?? undefined,
    ),
  );
};
