import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadAppRunsPage, loadAppRunsExtras } from '$lib/server/app-runs-page';
import { APP_NODES_QUERY, APP_FLOWS_PAGE_QUERY } from '$lib/server/queries';
import { flowPageSummaries, type FlowGraphNode } from '$lib/flow/flows';
import { APP_DISPLAY_PAGE_SIZE, appListNavigation, appListOffset } from '../app-list-pages';
import { error, redirect } from '@sveltejs/kit';
import { withQuery } from '$lib/safeRedirect';
import { runAppFlow } from '$lib/server/run-app-flow';
import type { Actions, PageServerLoad } from './$types';
export const load: PageServerLoad = async ({ params, url, request, locals, parent }) => {
  // A failed native action is followed by load with the original POST.
  // 308 here would replay that POST. Keep its refusal/draft render instead;
  // successful writes already leave through the action's existing 303.
  if (request?.method === 'POST') {
    const client = gqlClient(locals.token);
    const app = await loadTasksApp(client, params.appId);
    if (!app) error(404, 'App not found');
    const flowsOffset = appListOffset(url.searchParams, 'flowsOffset');
    const [section, extras, flowsPage, flowGraph] = await Promise.all([
      loadAppRunsPage(client, params.appId, url.searchParams), loadAppRunsExtras(client, params.appId),
      client.request<{ appNodesPage: { items: FlowGraphNode[]; total: number; hasMore: boolean } }>(APP_FLOWS_PAGE_QUERY, {
        appRef: params.appId, limit: APP_DISPLAY_PAGE_SIZE, offset: flowsOffset,
      }).then((r) => r.appNodesPage).catch(e => {
        console.warn('[app-runs] legacy Flows read failed', e);
        return { items: [] as FlowGraphNode[], total: 0, hasMore: false, failed: true };
      }),
      client.request<{ appNodes: FlowGraphNode[] }>(APP_NODES_QUERY, { appRef: params.appId, limit: 500 })
        .then((r) => r.appNodes)
        .catch((e) => {
          console.warn('[app-runs] Flow graph read failed', e);
          return [] as FlowGraphNode[];
        }),
    ]);
    return { legacyPanel: {
      ...section, ...extras,
      app: { ...app, organizationId: app.organizationId ?? null },
      flows: flowPageSummaries(flowsPage.items, flowGraph),
      flowsPage: appListNavigation(url, 'flowsOffset', 'runs', flowsOffset, flowsPage.items.length, flowsPage.total, { hasMore: flowsPage.hasMore }),
      flowsError: 'failed' in flowsPage,
    } };
  }
  await parent(); // The layout must finish its active-organisation cookie write first.
  const query = new URLSearchParams(url.search); query.set('tab', 'runs');
  redirect(308, withQuery(`/app/apps/${encodeURIComponent(params.appId)}`, query.toString()));
};
export const actions: Actions = { run: runAppFlow };
