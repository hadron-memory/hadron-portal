import { error, isHttpError, json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { canonicalTaskId } from '$lib/server/agent-tasks';
import { taskDispositions } from '$lib/server/task-dispositions';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import type { DispositionsRead } from '$lib/agent-tasks/dispositions';
import type { RequestHandler } from './$types';

/**
 * portal#1643 — a task's current finding dispositions, for the Findings section
 * to draw beside the immutable findings and to re-read after a write. Follows
 * the findings endpoint: the viewer's own token, the readable App and canonical
 * task resolved HERE, private and uncached. An unreadable App or task keeps the
 * existing neutral 404 before any disposition read.
 */
export const GET: RequestHandler = async ({ locals, params }) => {
  const headers = { 'cache-control': 'no-store' };
  try {
    const client = gqlClient(locals.token);
    const taskId = await canonicalTaskId(client, params.appId, params.taskId);
    const read = await withTimeout(taskDispositions(client, params.appId, taskId), OPTIONAL_LIST_TIMEOUT_MS, { kind: 'failed' } as DispositionsRead);
    return json(read, { headers, status: read.kind === 'unavailable' ? 404 : 200 });
  } catch (e) {
    if (isHttpError(e)) throw e;
    return json({ kind: 'failed' } satisfies DispositionsRead, { headers });
  }
};
