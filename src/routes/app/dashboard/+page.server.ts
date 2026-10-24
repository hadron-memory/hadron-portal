// #629: /app/dashboard is the stats page for EVERY user (an org page is the
// wrong content for a dashboard). #636: it renders a widget grid whose layout
// (the caller's placed widgets) and per-widget data both come from the server
// through independently streamed layout/data reads (#1230; server #772).
// The in-place editor (server #788) saves the layout back via ?/saveLayout.
import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { DASHBOARD_LAYOUT_QUERY, DASHBOARD_QUERY, SET_DASHBOARD_WIDGETS_MUTATION } from '$lib/server/queries';
import { WIDGET_TYPE_FROM_SERVER, WIDGET_TYPE_TO_SERVER } from '$lib/dashboard/widgets/types';
import { lookupOwn } from '$lib/lookup';
import type { WidgetDataMap, WidgetPlacement, WidgetType } from '$lib/dashboard/widgets/types';
import { DEFAULT_PLACEMENTS } from '$lib/dashboard/widgets/defaults';
import type { Actions, PageServerLoad } from './$types';

interface ServerWidget {
  id: string;
  type: string;
  span: number;
  rowSpan: number;
  position: number;
  config: Record<string, unknown> | null;
}
interface ServerWidgetData {
  widgetId: string;
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
      // #835: guarded lookup — `w.type` is wire data. The GraphQL enum is the
      // real gate here (DashboardWidgetType has three members, so a prototype
      // key cannot survive validation); this is belt-and-braces so the class
      // reads the same at every site rather than needing that argument re-made.
      const type = lookupOwn(WIDGET_TYPE_FROM_SERVER, w.type);
      return type
        ? [{ id: w.id, type, span: w.span, rowSpan: w.rowSpan, config: w.config ?? null }]
        : [];
    });
}

export const load: PageServerLoad = ({ locals }) => {
  const client = gqlClient(locals.token);
  // Both promises are returned immediately. Attach failure handling now so a
  // rejection before the streamed await block subscribes cannot be unhandled.
  const dashboard = client.request<{ dashboardWidgets: ServerWidget[] }>(DASHBOARD_LAYOUT_QUERY)
    .then(data => {
      const placements = toPlacements(data.dashboardWidgets);
      return { placements: placements.length ? placements : DEFAULT_PLACEMENTS, loadFailed: false };
    })
    .catch(() => ({ placements: DEFAULT_PLACEMENTS, loadFailed: true }));
  const widgetData = client.request<{
    memories: { total: number };
    agents: { total: number };
    dashboardWidgetData: ServerWidgetData[];
  }>(DASHBOARD_QUERY).then(data => {
    const widgets: WidgetDataMap = {};
    for (const d of data.dashboardWidgetData) {
      if (lookupOwn(WIDGET_TYPE_FROM_SERVER, d.type)) widgets[d.widgetId] = d.data;
    }
    if (!widgets['memory-stats']) widgets['memory-stats'] = { memoryCount: data.memories.total };
    if (!widgets['agent-stats']) widgets['agent-stats'] = { agentCount: data.agents.total };
    return { data: widgets, loadFailed: false };
  }).catch(() => ({ data: {} as WidgetDataMap, loadFailed: true }));
  return { dashboard, widgetData };
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
        typeof rec.type === 'string' ? lookupOwn(WIDGET_TYPE_TO_SERVER, rec.type) : undefined;
      if (!serverType) return [];
      return [
        {
          id: typeof rec.id === 'string' && rec.id.length > 0 ? rec.id : null,
          type: serverType,
          span: clampInt(rec.span, SPAN_MIN, SPAN_MAX, 4),
          rowSpan: clampInt(rec.rowSpan, ROW_SPAN_MIN, ROW_SPAN_MAX, 1),
          // Plain objects only — an array is `typeof 'object'` but doesn't
          // match the widget config shape (Copilot on #660).
          config:
            rec.config != null && typeof rec.config === 'object' && !Array.isArray(rec.config)
              ? rec.config
              : null,
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
