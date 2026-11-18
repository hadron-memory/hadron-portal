import { error, isHttpError, json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { canonicalTaskRef } from '$lib/server/agent-tasks';
import { taskFindingsPage } from '$lib/server/task-findings';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import { parseFindingsOffset, type FindingsRead } from '$lib/agent-tasks/findings';
import type { RequestHandler } from './$types';

/**
 * portal#1637 — one page of a task's immutable findings, for the Findings
 * section's pager and Retry. Follows the relations endpoint: the viewer's own
 * token, the readable App and canonical task resolved HERE (a client-supplied
 * App/task pair is never trusted, and the findings read is checked against the
 * RESOLVED App id, never the URL's form of it: portal#2111), private and
 * uncached. An unreadable App or task keeps the existing neutral 404 before any
 * findings read.
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const offset = parseFindingsOffset(url.searchParams.get('offset'));
  if (offset === null) error(400, 'Invalid findings page');
  const headers = { 'cache-control': 'no-store' };
  try {
    const client = gqlClient(locals.token);
    const { appId, taskId } = await canonicalTaskRef(client, params.appId, params.taskId);
    // Same optional-read budget as the first page: past it the answer is unknown, never an empty page.
    const read = await withTimeout(taskFindingsPage(client, appId, taskId, offset), OPTIONAL_LIST_TIMEOUT_MS, { kind: 'failed' } as FindingsRead);
    return json(read, { headers, status: read.kind === 'unavailable' ? 404 : 200 });
  } catch (e) {
    if (isHttpError(e)) throw e;
    return json({ kind: 'failed' } satisfies FindingsRead, { headers });
  }
};
