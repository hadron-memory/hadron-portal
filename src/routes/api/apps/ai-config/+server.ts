import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  APP_AI_CONFIG_QUERY,
  UPDATE_APP_AI_CONFIG_MUTATION,
  CLEAR_APP_AI_CONFIG_MUTATION,
} from '$lib/server/queries';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const appId = url.searchParams.get('appId');
  if (!appId) {
    return json({ error: 'appId is required' }, { status: 400 });
  }

  try {
    const data = await gqlClient(locals.token).request<{
      appAIConfig: { provider: string; apiKey: string; model: string } | null;
    }>(APP_AI_CONFIG_QUERY, { appId });

    if (!data.appAIConfig) {
      return json({ provider: null, apiKey: null, model: null });
    }

    return json(data.appAIConfig);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to load AI config';
    return json({ error: msg }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { appId, provider, apiKey, model } = await request.json();

  if (!appId || !provider || !apiKey || !model) {
    return json(
      { error: 'appId, provider, apiKey, and model are required' },
      { status: 400 },
    );
  }

  try {
    const result = await gqlClient(locals.token).request<{
      updateApp: { aiProvider: string; aiModel: string; hasAiApiKey: boolean };
    }>(UPDATE_APP_AI_CONFIG_MUTATION, {
      id: appId,
      aiProvider: provider,
      aiModel: model,
      aiApiKey: apiKey,
    });

    return json({ ok: true, app: result.updateApp });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Failed to save AI config';
    return json({ error: msg }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
  if (!locals.token) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { appId } = await request.json();

  if (!appId) {
    return json({ error: 'appId is required' }, { status: 400 });
  }

  try {
    await gqlClient(locals.token).request(CLEAR_APP_AI_CONFIG_MUTATION, {
      id: appId,
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
