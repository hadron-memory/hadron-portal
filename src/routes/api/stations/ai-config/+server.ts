import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  UPDATE_STATION_AI_CONFIG_MUTATION,
  CLEAR_STATION_AI_CONFIG_MUTATION,
} from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { stationId, provider, apiKey, model } = await request.json();

  if (!stationId || !provider || !apiKey || !model) {
    return json(
      { error: 'stationId, provider, apiKey, and model are required' },
      { status: 400 },
    );
  }

  try {
    const result = await gqlClient(locals.token).request<{
      updateStation: { aiProvider: string; aiModel: string; hasAiApiKey: boolean };
    }>(UPDATE_STATION_AI_CONFIG_MUTATION, {
      id: stationId,
      aiProvider: provider,
      aiModel: model,
      aiApiKey: apiKey,
    });

    return json({ ok: true, station: result.updateStation });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to save AI config';
    return json({ error: msg }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { stationId } = await request.json();

  if (!stationId) {
    return json({ error: 'stationId is required' }, { status: 400 });
  }

  try {
    await gqlClient(locals.token).request(CLEAR_STATION_AI_CONFIG_MUTATION, {
      id: stationId,
      aiProvider: null,
      aiModel: null,
      aiApiKey: null,
    });
    return json({ ok: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to clear AI config';
    return json({ error: msg }, { status: 500 });
  }
};
