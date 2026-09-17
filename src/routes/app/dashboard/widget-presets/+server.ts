// #806: create / delete named widget presets from the editor. Thin JSON shims
// over the owner-gated server mutations; the list rides /app/dashboard/
// editor-options. Copy-on-apply semantics live entirely client-side — these
// endpoints only manage the palette.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import {
  CREATE_DASHBOARD_WIDGET_PRESET_MUTATION,
  DELETE_DASHBOARD_WIDGET_PRESET_MUTATION,
} from '$lib/server/queries';
import { WIDGET_TYPE_FROM_SERVER, WIDGET_TYPE_TO_SERVER } from '$lib/dashboard/widgets/types';
import { lookupOwn } from '$lib/lookup';
import type { WidgetType } from '$lib/dashboard/widgets/types';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
  const body = (await request.json().catch(() => ({}))) as {
    type?: unknown;
    name?: unknown;
    config?: unknown;
  };
  const serverType =
    typeof body.type === 'string' ? lookupOwn(WIDGET_TYPE_TO_SERVER, body.type) : undefined;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!serverType || !name || body.config == null || typeof body.config !== 'object' || Array.isArray(body.config)) {
    return json({ error: 'Invalid preset payload.' }, { status: 400 });
  }
  try {
    const data = await gqlClient(locals.token).request<{
      createDashboardWidgetPreset: {
        id: string;
        type: string;
        name: string;
        config: Record<string, unknown>;
      };
    }>(CREATE_DASHBOARD_WIDGET_PRESET_MUTATION, { type: serverType, name, config: body.config });
    const p = data.createDashboardWidgetPreset;
    return json({
      preset: { id: p.id, type: lookupOwn(WIDGET_TYPE_FROM_SERVER, p.type), name: p.name, config: p.config },
    });
  } catch (e) {
    // Duplicate names come back as BAD_USER_INPUT with a human message — the
    // editor shows it inline next to the save control.
    return json({ error: extractGqlError(e, 'Failed to save the preset.') }, { status: 400 });
  }
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
  const body = (await request.json().catch(() => ({}))) as { presetRef?: unknown };
  if (typeof body.presetRef !== 'string' || !body.presetRef) {
    return json({ error: 'presetRef is required.' }, { status: 400 });
  }
  try {
    await gqlClient(locals.token).request(DELETE_DASHBOARD_WIDGET_PRESET_MUTATION, {
      presetRef: body.presetRef,
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: extractGqlError(e, 'Failed to delete the preset.') }, { status: 400 });
  }
};
