import { error, isHttpError, json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { canonicalTaskId, loadTasksApp } from '$lib/server/agent-tasks';
import { taskDependencyPage } from '$lib/server/task-planning';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
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
    // portal#1392: one Load-more page has the same optional-read budget as the first page;
    // past it the answer is unknown (the picker's "Couldn’t load more"), never an empty page.
    return json(await withTimeout(taskDependencyPage(client, app.id, taskId, direction, offset), OPTIONAL_LIST_TIMEOUT_MS, { kind: 'failed' } as const), { headers });
  } catch (e) {
    if (isHttpError(e)) throw e;
    return json({ kind: 'failed' }, { headers });
  }
};
