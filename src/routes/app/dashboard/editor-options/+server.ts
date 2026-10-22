// #666/#806: everything the dashboard EDITOR needs beyond the page payload —
// the usage-activity scope picker's memory options and the caller's saved
// widget presets. A separate, lazily-hit endpoint (the page fetches it when
// the user enters Customize) so the plain dashboard view never pays for it.
// The memory list walks the caller's FULL readable set page by page (Codex on
// #666), bounded by a generous ceiling.
import { json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { DASHBOARD_WIDGET_PRESETS_QUERY, MEMORY_OPTIONS_QUERY } from '$lib/server/queries';
import { WIDGET_TYPE_FROM_SERVER } from '$lib/dashboard/widgets/types';
import { lookupOwn } from '$lib/lookup';
import type { WidgetType } from '$lib/dashboard/widgets/types';
import type { RequestHandler } from './$types';

export interface MemoryOption {
  id: string;
  name: string;
}

export interface WidgetPreset {
  id: string;
  /** Portal widget id (server enum already mapped). */
  type: WidgetType;
  name: string;
  config: Record<string, unknown>;
}

const PAGE_SIZE = 100;
/** Backstop against a pathological caller-readable set; flagged as truncated. */
const MAX_OPTIONS = 1000;

export const GET: RequestHandler = async ({ locals }) => {
  // The two lists fail INDEPENDENTLY (Codex/Copilot on #671): a transient
  // preset failure must not blank the unrelated memory picker, and vice versa.
  // Each failed list comes back empty with its own flag; the page retries on
  // the next editor open while the editor degrades gracefully in the meantime.
  const options: MemoryOption[] = [];
  let optionsFailed = false;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  try {
    while (offset < total && options.length < MAX_OPTIONS) {
      const data = await gqlClient(locals.token).request<{
        memories: { items: MemoryOption[]; total: number };
      }>(MEMORY_OPTIONS_QUERY, { limit: PAGE_SIZE, offset });
      options.push(...data.memories.items.map(({ id, name }) => ({ id, name })));
      total = data.memories.total;
      // An EMPTY page ends the drain, not the first short one (a server clamp).
      if (data.memories.items.length === 0) break;
      offset += data.memories.items.length;
    }
  } catch (e) {
    console.error('[dashboard/editor-options] memory options failed to load:', e);
    options.length = 0;
    optionsFailed = true;
  }

  let presets: WidgetPreset[] = [];
  let presetsFailed = false;
  try {
    const presetData = await gqlClient(locals.token).request<{
      dashboardWidgetPresets: Array<{
        id: string;
        type: string;
        name: string;
        config: Record<string, unknown>;
      }>;
    }>(DASHBOARD_WIDGET_PRESETS_QUERY);
    // Map the server enum to portal ids, dropping presets for types this
    // portal build doesn't know (defensive, mirrors the placements loader).
    presets = presetData.dashboardWidgetPresets.flatMap((p) => {
      const type = lookupOwn(WIDGET_TYPE_FROM_SERVER, p.type);
      return type ? [{ id: p.id, type, name: p.name, config: p.config }] : [];
    });
  } catch (e) {
    console.error('[dashboard/editor-options] presets failed to load:', e);
    presetsFailed = true;
  }

  return json({
    options,
    presets,
    truncated: options.length >= MAX_OPTIONS,
    loadFailed: optionsFailed,
    presetsFailed,
  });
};
