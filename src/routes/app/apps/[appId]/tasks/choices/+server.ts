import { json, error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { taskChoices } from '$lib/server/task-planning';
import type { RequestHandler } from './$types';
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) error(404, 'App not found');
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) error(400, 'Invalid offset');
    // portal#1575: `ended=1` is the reference picker's mode (ended tasks too); the server-side list is fixed.
  const includeEnded = url.searchParams.get('ended') === '1';
  return json(await taskChoices(client, app, offset, url.searchParams.get('exact')?.trim(), { includeEnded }), { headers: { 'cache-control': 'no-store' } });
};
