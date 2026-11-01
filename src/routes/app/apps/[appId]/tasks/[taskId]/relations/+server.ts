import { error, isHttpError, json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { canonicalTaskId, loadTasksApp } from '$lib/server/agent-tasks';
import { taskDependencyPage } from '$lib/server/task-planning';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals, params, url }) => {
  const direction = url.searchParams.get('direction');
  const rawOffset = url.searchParams.get('offset') ?? '0';
  const offset = Number(rawOffset);
  if ((direction !== 'blockedBy' && direction !== 'blocks') || !/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset > 2147483647) error(400, 'Invalid relation page');
  const headers = { 'cache-control': 'no-store' };
  try {
    const client = gqlClient(locals.token);
    // Existing readable-task/App resolution, same viewer token as the detail page.
    const app = await loadTasksApp(client, params.appId);
    if (!app) error(404, 'App not found');
    const taskId = await canonicalTaskId(client, app.id, params.taskId);
    return json(await taskDependencyPage(client, app.id, taskId, direction, offset), { headers });
  } catch (e) {
    if (isHttpError(e)) throw e;
    return json({ kind: 'failed' }, { headers });
  }
};
