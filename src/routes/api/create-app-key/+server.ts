import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { appKeyRefusal } from '$lib/server/app-key-refusal';
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
    }>(CREATE_APP_KEY_MUTATION, { appRef: appId, label: label || null });

    return json(result.createAppKey);
  } catch (e: unknown) {
    // portal#1068: the same refusal copy as the App Keys tab, as a 403.
    const { status, text } = appKeyRefusal(e, 'Failed to create app key');
    return json({ error: text }, { status });
  }
};
