import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { CREATE_STATION_KEY_MUTATION } from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { stationId, label } = await request.json();
  if (!stationId) {
    return json({ error: 'stationId is required' }, { status: 400 });
  }

  try {
    const result = await gqlClient(locals.token).request<{
      createStationKey: { key: { id: string; label: string; createdAt: string }; rawKey: string };
    }>(CREATE_STATION_KEY_MUTATION, { stationId, label: label || null });

    return json(result.createStationKey);
  } catch (e: unknown) {
    return json(
      { error: e instanceof Error ? e.message : 'Failed to create station key' },
      { status: 500 },
    );
  }
};
