import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { CREATE_APP_KEY_MUTATION } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { appId, label } = await request.json();
  if (!appId) {
    return json({ error: 'appId is required' }, { status: 400 });
  }

  try {
    const result = await gqlClient(locals.token).request<{
      createAppKey: { key: { id: string; label: string; createdAt: string }; rawKey: string };
    }>(CREATE_APP_KEY_MUTATION, { appId, label: label || null });

    return json(result.createAppKey);
  } catch (e: unknown) {
    return json(
      { error: extractGqlError(e, 'Failed to create app key') },
      { status: 500 },
    );
  }
};
