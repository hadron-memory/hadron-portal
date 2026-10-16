import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { BOARD_LIMIT, loadBoard } from '$lib/server/agent-tasks';
import { parseBoardFilter } from '$lib/agent-tasks/status';
import type { PageServerLoad } from './$types';

export type TasksApp = { id: string; name: string; urn: string; organizationId: string | null };

/**
 * portal#1052 — the App's task board: its root tasks, read-only (Holger
 * #10660). A sub-route of its own, like Runs and Channels, so a task read
 * that refuses a non-participant (APP_NOT_FOUND) can never reach the App
 * page's loader, and the board, a filter and a task are each linkable
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-views §2).
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  const filter = parseBoardFilter(url.searchParams.get('status'));

  // The App's header comes first and alone: a missing App is a 404 whatever
  // the task read would have said.
  const appData = await client.request<{ app: TasksApp | null }>(AGENT_TASKS_APP_QUERY, { ref: params.appId });
  if (!appData.app) throw error(404, 'App not found');
  const app = appData.app;

  const board = await loadBoard(client, app.id, filter);

  return {
    app,
    filter,
    board,
    boardLimit: BOARD_LIMIT,
    loadedAt: new Date().toISOString(),
    // §8: a non-participant who is impersonating is told whose view it is.
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };
};
