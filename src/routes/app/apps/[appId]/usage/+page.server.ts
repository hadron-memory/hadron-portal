import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadUsageView } from '$lib/server/app-usage-projection';
import type { PageServerLoad } from './$types';
/** Isolated from the shared App loader: refused usage reads never blank the App page. */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  return { app, view: await loadUsageView(client, app.id, url.searchParams), key: url.pathname + url.search };
};
