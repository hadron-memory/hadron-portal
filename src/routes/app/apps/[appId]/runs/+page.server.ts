import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadAppRunsPage, loadAppRunsExtras } from '$lib/server/app-runs-page';
import { APP_NODES_QUERY } from '$lib/server/queries';
import { flowRoots, type FlowGraphNode } from '$lib/flow/flows';
import { isCapped } from '$lib/server/capped';
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
    const [section, extras, nodes] = await Promise.all([
      loadAppRunsPage(client, params.appId, url.searchParams), loadAppRunsExtras(client, params.appId),
      client.request<{ appNodes: FlowGraphNode[] }>(APP_NODES_QUERY, { appRef: params.appId, limit: 500 }).catch(e => { console.warn('[app-runs] legacy Flows read failed', e); return { appNodes: [] }; }),
    ]);
    return { legacyPanel: { ...section, ...extras, app: { ...app, organizationId: app.organizationId ?? null }, flows: flowRoots(nodes.appNodes), flowsCapped: isCapped(nodes.appNodes.length, 500), flowsScanned: nodes.appNodes.length } };
  }
  await parent(); // The layout must finish its active-organisation cookie write first.
  const query = new URLSearchParams(url.search); query.set('tab', 'runs');
  redirect(308, withQuery(`/app/apps/${encodeURIComponent(params.appId)}`, query.toString()));
};
export const actions: Actions = { run: runAppFlow };
