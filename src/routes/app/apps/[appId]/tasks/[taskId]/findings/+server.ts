import { error, isHttpError, json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { canonicalTaskId } from '$lib/server/agent-tasks';
import { loadTaskFindings } from '$lib/server/task-findings';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import type { RequestHandler } from './$types';

/** portal#1637: one section-owned, viewer-scoped immutable-findings read. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const rawOffset = url.searchParams.get('offset') ?? '0';
  const offset = Number(rawOffset);
  if (!/^\d+$/.test(rawOffset) || !Number.isSafeInteger(offset) || offset > 2147483647) {
    error(400, 'Invalid findings page');
  }
  const headers = { 'cache-control': 'no-store' };
  if (!locals.token) return json({ kind: 'failed' }, { status: 401, headers });

  try {
    const client = gqlClient(locals.token);
    // This helper resolves the readable App first, qualifies handles with that
    // App, and refuses a task answered for another App before findings are read.
    const taskId = await canonicalTaskId(client, params.appId, params.taskId);
    return json(
      await withTimeout(loadTaskFindings(client, taskId, offset), OPTIONAL_LIST_TIMEOUT_MS, { kind: 'failed' } as const),
      { headers },
    );
  } catch (e) {
    if (isHttpError(e)) throw e;
    return json({ kind: 'failed' }, { headers });
  }
};
