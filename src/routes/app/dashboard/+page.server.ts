// #629: /app/dashboard is the stats page for EVERY user (an org page is the
// wrong content for a dashboard). #636: it renders a widget grid whose layout
// (the caller's placed widgets) and per-widget data both come from the server
// in a single request (dashboardWidgets + dashboardWidgetData — server #772).
import { gqlClient } from '$lib/server/api';
import { DASHBOARD_QUERY } from '$lib/server/queries';
import { WIDGET_TYPE_FROM_SERVER } from '$lib/dashboard/widgets/types';
import type { WidgetDataMap, WidgetPlacement } from '$lib/dashboard/widgets/types';
import type { PageServerLoad } from './$types';

export interface DashboardMemory {
  id: string;
  name: string;
  urn: string;
  class: string;
}

interface ServerWidget {
  type: string;
  span: number;
  position: number;
}
interface ServerWidgetData {
  type: string;
  data: Record<string, unknown>;
}

// Default layout when the user hasn't customized their dashboard (no widget
// picker yet — server-persisted selection is respected once they have one).
const DEFAULT_PLACEMENTS: WidgetPlacement[] = [{ type: 'memory-stats', span: 4 }];

/** Map the server's placed-widget list → portal placements, ordered by the
 *  server's `position` (sorted defensively rather than trusting array order),
 *  skipping any unknown enum value. */
function toPlacements(widgets: ServerWidget[]): WidgetPlacement[] {
  return [...widgets]
    .sort((a, b) => a.position - b.position)
    .flatMap((w) => {
      const type = WIDGET_TYPE_FROM_SERVER[w.type];
      return type ? [{ type, span: w.span }] : [];
    });
}

export const load: PageServerLoad = async ({ locals }) => {
  // Bounded, slim query — a count + a five-item preview, not the whole memory
  // set (review: don't fetchAllItems just for a count). Surface a failed fetch
  // rather than silently reporting "0 memories" (conventions:no-silent-loader-catch).
  try {
    const data = await gqlClient(locals.token).request<{
      memories: { items: DashboardMemory[]; total: number };
      dashboardWidgets: ServerWidget[];
      dashboardWidgetData: ServerWidgetData[];
    }>(DASHBOARD_QUERY);

    const memoryCount = data.memories.total;

    const placements = toPlacements(data.dashboardWidgets);
    const effectivePlacements = placements.length > 0 ? placements : DEFAULT_PLACEMENTS;

    // Fan the combined data out by portal WidgetType.
    const widgetData: WidgetDataMap = {};
    for (const d of data.dashboardWidgetData) {
      const type = WIDGET_TYPE_FROM_SERVER[d.type];
      if (type) widgetData[type] = d.data;
    }
    // The default memory-stats widget renders before the user activates any
    // widget server-side (dashboardWidgetData is empty until then), so seed its
    // data from the memories total — the same count the widget shows.
    if (!widgetData['memory-stats']) widgetData['memory-stats'] = { memoryCount };

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
      widgetData: { 'memory-stats': { memoryCount: 0 } } as WidgetDataMap,
      loadFailed: true,
    };
  }
};
