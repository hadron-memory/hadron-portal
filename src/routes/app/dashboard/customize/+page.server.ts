// #636: the dashboard widget picker. Reads the caller's current widget selection
// and replaces it wholesale via setDashboardWidgets. User-scoped config, so no
// requireNonConsumer — any signed-in user can customize their own dashboard.
import { fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { extractGqlError } from '$lib/server/gqlError';
import { DASHBOARD_WIDGETS_QUERY, SET_DASHBOARD_WIDGETS_MUTATION } from '$lib/server/queries';
import { WIDGET_TYPE_FROM_SERVER, WIDGET_TYPE_TO_SERVER } from '$lib/dashboard/widgets/types';
import type { WidgetPlacement, WidgetType } from '$lib/dashboard/widgets/types';
import { DEFAULT_PLACEMENTS } from '$lib/dashboard/widgets/defaults';
import type { Actions, PageServerLoad } from './$types';

interface ServerWidget {
  type: string;
  span: number;
  position: number;
}

const SPAN_MIN = 1;
const SPAN_MAX = 12;

export const load: PageServerLoad = async ({ locals }) => {
  const data = await gqlClient(locals.token).request<{ dashboardWidgets: ServerWidget[] }>(
    DASHBOARD_WIDGETS_QUERY,
  );

  const placements: WidgetPlacement[] = [...data.dashboardWidgets]
    .sort((a, b) => a.position - b.position)
    .flatMap((w) => {
      const type = WIDGET_TYPE_FROM_SERVER[w.type];
      return type ? [{ type, span: w.span }] : [];
    });

  // Pre-populate the picker with the default layout when the user hasn't
  // customized — so editing starts from what the dashboard actually shows.
  return { placements: placements.length > 0 ? placements : DEFAULT_PLACEMENTS };
};

export const actions: Actions = {
  default: async ({ request, locals }) => {
    const raw = (await request.formData()).get('widgets');
    let parsed: unknown;
    try {
      parsed = JSON.parse(typeof raw === 'string' ? raw : '[]');
    } catch {
      return fail(400, { error: 'Could not read the widget layout — please try again.' });
    }
    if (!Array.isArray(parsed)) {
      return fail(400, { error: 'Invalid widget layout.' });
    }

    // Map portal widget ids → the server enum, dropping any unknown type. Array
    // order becomes the server `position`; span is clamped here too (the server
    // clamps as well, but keep the wire value sane).
    const widgets = parsed.flatMap((w) => {
      const type = (w as { type?: string })?.type as WidgetType | undefined;
      const serverType = type ? WIDGET_TYPE_TO_SERVER[type] : undefined;
      if (!serverType) return [];
      const rawSpan = Number((w as { span?: unknown })?.span);
      const span = Number.isFinite(rawSpan)
        ? Math.min(SPAN_MAX, Math.max(SPAN_MIN, Math.trunc(rawSpan)))
        : undefined;
      return [{ type: serverType, span }];
    });

    try {
      await gqlClient(locals.token).request(SET_DASHBOARD_WIDGETS_MUTATION, { widgets });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to save your dashboard.') });
    }
    // `redirect` throws — outside the try so the catch can't swallow it.
    redirect(303, '/app/dashboard');
  },
};
