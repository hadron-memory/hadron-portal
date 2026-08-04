import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { REGENERATE_APP_KEY_MUTATION } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { appId } = await request.json();
  if (!appId) {
    return json({ error: 'appId is required' }, { status: 400 });
  }

  try {
    const result = await gqlClient(locals.token).request<{
      regenerateAppKey: { rawKey: string };
    }>(REGENERATE_APP_KEY_MUTATION, { appRef: appId });

    return json({ rawKey: result.regenerateAppKey.rawKey });
  } catch (e: unknown) {
    return json(
      { error: extractGqlError(e, 'Failed to regenerate key') },
      { status: 500 },
    );
  }
};
