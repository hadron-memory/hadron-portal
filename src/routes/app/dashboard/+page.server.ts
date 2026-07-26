// #629: /app/dashboard is the stats page for EVERY user (an org page is the
// wrong content for a dashboard). #636: it renders a widget grid whose layout
// (the caller's placed widgets) and per-widget data both come from the server
// in a single request (dashboardWidgets + dashboardWidgetData — server #772).
// The in-place editor (server #788) saves the layout back via ?/saveLayout.
import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { DASHBOARD_QUERY, SET_DASHBOARD_WIDGETS_MUTATION } from '$lib/server/queries';
import { WIDGET_TYPE_FROM_SERVER, WIDGET_TYPE_TO_SERVER } from '$lib/dashboard/widgets/types';
import type { WidgetDataMap, WidgetPlacement, WidgetType } from '$lib/dashboard/widgets/types';
import { DEFAULT_PLACEMENTS } from '$lib/dashboard/widgets/defaults';
import type { Actions, PageServerLoad } from './$types';

export interface DashboardMemory {
  id: string;
  name: string;
  urn: string;
  class: string;
}

interface ServerWidget {
  id: string;
  type: string;
  span: number;
  rowSpan: number;
  position: number;
  config: Record<string, unknown> | null;
}
interface ServerWidgetData {
  type: string;
  data: Record<string, unknown>;
}

/** Map the server's placed-widget list → portal placements, ordered by the
 *  server's `position` (sorted defensively rather than trusting array order),
 *  skipping any unknown enum value. */
function toPlacements(widgets: ServerWidget[]): WidgetPlacement[] {
  return [...widgets]
    .sort((a, b) => a.position - b.position)
    .flatMap((w) => {
      const type = WIDGET_TYPE_FROM_SERVER[w.type];
      return type
        ? [{ id: w.id, type, span: w.span, rowSpan: w.rowSpan, config: w.config ?? null }]
        : [];
    });
}

export const load: PageServerLoad = async ({ locals }) => {
  // Bounded, slim query — a count + a five-item preview, not the whole memory
  // set (review: don't fetchAllItems just for a count). Surface a failed fetch
  // rather than silently reporting "0 memories" (conventions:no-silent-loader-catch).
  try {
    const data = await gqlClient(locals.token).request<{
      memories: { items: DashboardMemory[]; total: number };
      agents: { total: number };
      dashboardWidgets: ServerWidget[];
      dashboardWidgetData: ServerWidgetData[];
    }>(DASHBOARD_QUERY);

    const memoryCount = data.memories.total;
    const agentCount = data.agents.total;

    const placements = toPlacements(data.dashboardWidgets);
    const effectivePlacements = placements.length > 0 ? placements : DEFAULT_PLACEMENTS;

    // Fan the combined data out by portal WidgetType.
    const widgetData: WidgetDataMap = {};
    for (const d of data.dashboardWidgetData) {
      const type = WIDGET_TYPE_FROM_SERVER[d.type];
      if (type) widgetData[type] = d.data;
    }
    // Default widgets render before the user activates any widget server-side
    // (dashboardWidgetData is empty until then), so seed each default widget's
    // data from the counts already fetched — the same numbers the widgets show.
    if (!widgetData['memory-stats']) widgetData['memory-stats'] = { memoryCount };
    if (!widgetData['agent-stats']) widgetData['agent-stats'] = { agentCount };

    return {
      memoryCount,
      preview: data.memories.items,
      placements: effectivePlacements,
      widgetData,
      loadFailed: false,
    };
  } catch (e) {
    console.error('[dashboard] failed to load stats:', e);
    return {
      memoryCount: 0,
      preview: [] as DashboardMemory[],
      placements: DEFAULT_PLACEMENTS,
      widgetData: {
        'memory-stats': { memoryCount: 0 },
        'agent-stats': { agentCount: 0 },
      } as WidgetDataMap,
      loadFailed: true,
    };
  }
};

const SPAN_MIN = 1;
const SPAN_MAX = 12;
const ROW_SPAN_MIN = 1;
const ROW_SPAN_MAX = 4;

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export const actions: Actions = {
  // #788: the in-place editor posts the full layout as JSON — array order
  // becomes the server `position`; placements carrying a server row `id` are
  // updated in place there, so ids survive the save.
  saveLayout: async ({ request, locals }) => {
    const raw = (await request.formData()).get('widgets');
    // A MISSING field is a malformed request, not an intentional empty layout —
    // don't silently clear the user's dashboard (Copilot review on #643). An
    // intentional "no widgets" save posts the string '[]'.
    if (typeof raw !== 'string') {
      return fail(400, { error: 'Could not read the widget layout — please try again.' });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail(400, { error: 'Could not read the widget layout — please try again.' });
    }
    if (!Array.isArray(parsed)) {
      return fail(400, { error: 'Invalid widget layout.' });
    }

    // Map portal widget ids → the server enum, dropping any unknown type.
    // span/rowSpan are non-null on the wire (server #788) and clamped here too
    // (the server clamps as well, but keep the wire value sane).
    const widgets = parsed.flatMap((w) => {
      const rec = (w ?? {}) as {
        id?: unknown;
        type?: unknown;
        span?: unknown;
        rowSpan?: unknown;
        config?: unknown;
      };
      const serverType =
        typeof rec.type === 'string' ? WIDGET_TYPE_TO_SERVER[rec.type as WidgetType] : undefined;
      if (!serverType) return [];
      return [
        {
          id: typeof rec.id === 'string' && rec.id.length > 0 ? rec.id : null,
          type: serverType,
          span: clampInt(rec.span, SPAN_MIN, SPAN_MAX, 4),
          rowSpan: clampInt(rec.rowSpan, ROW_SPAN_MIN, ROW_SPAN_MAX, 1),
          config: rec.config != null && typeof rec.config === 'object' ? rec.config : null,
        },
      ];
    });

    try {
      await gqlClient(locals.token).request(SET_DASHBOARD_WIDGETS_MUTATION, { widgets });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to save your dashboard.') });
    }
    // Same-page action: use:enhance invalidates on success, so the refreshed
    // load carries the saved layout (with its server row ids) back down.
    return { saved: true };
  },
};
