import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { REGENERATE_API_KEY_MUTATION } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { clientId } = await request.json();
  if (!clientId) {
    return json({ error: 'clientId is required' }, { status: 400 });
  }

  try {
    const result = await gqlClient(locals.token).request<{
      regenerateApiKey: { rawKey: string };
    }>(REGENERATE_API_KEY_MUTATION, { id: clientId });

    return json({ rawKey: result.regenerateApiKey.rawKey });
  } catch (e: unknown) {
    return json(
      { error: e instanceof Error ? e.message : 'Failed to regenerate key' },
      { status: 500 },
    );
  }
};
