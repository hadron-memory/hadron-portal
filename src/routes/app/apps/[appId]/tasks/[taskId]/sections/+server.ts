import { error, isHttpError, json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { canonicalTaskRef, loadHistory, loadReview, loadWriteCandidates } from '$lib/server/agent-tasks';
import { taskClonesPage, taskDependencies } from '$lib/server/task-planning';
import { taskFindingsPage } from '$lib/server/task-findings';
import { fetchAllItems } from '$lib/server/paginate';
import { MEMORIES_QUERY } from '$lib/server/queries';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import type { FindingsRead } from '$lib/agent-tasks/findings';
import type { MemoriesRead } from '$lib/node-choices';
import { TASK_SECTIONS, type TaskSection } from '$lib/agent-tasks/sections';
import type { RequestHandler } from './$types';

type PickMemory = { id: string; name: string; urn: string; visibility: string | null };

/**
 * portal#2261 — one deferred section of the task detail page, read when the section is shown (the
 * page's first load carries only the facts, the subtask tree and the breadcrumb). Follows the findings
 * endpoint: the viewer's own token, the readable App and canonical task resolved HERE (a client-supplied
 * App/task pair is never trusted), private and uncached. An unreadable App or task keeps the neutral 404
 * before any section read. A failed section answers {kind:'failed'} as a VALUE: the section says it
 * couldn't load, never that it is empty (#1392/#1588).
 */
export const GET: RequestHandler = async ({ locals, params, url }) => {
  const section = url.searchParams.get('section') as TaskSection | null;
  if (!section || !TASK_SECTIONS.includes(section)) error(400, 'Invalid section');
  const headers = { 'cache-control': 'no-store' };
  try {
    const client = gqlClient(locals.token);
    const { appId, taskId } = await canonicalTaskRef(client, params.appId, params.taskId);
    const failed = { kind: 'failed' } as const;
    switch (section) {
      case 'history':
        return json(await loadHistory(client, appId, taskId), { headers });
      case 'review':
        // portal#1697: optional; a slow read costs the section, never the page.
        return json(await withTimeout(loadReview(client, appId, taskId), OPTIONAL_LIST_TIMEOUT_MS, failed), { headers });
      case 'dependencies':
        // portal#1392: past the optional-list budget the answer is unknown, never empty relations.
        return json(await withTimeout(taskDependencies(client, appId, taskId), OPTIONAL_LIST_TIMEOUT_MS, failed), { headers });
      case 'clones':
        return json(await withTimeout(taskClonesPage(client, appId, taskId, 0), OPTIONAL_LIST_TIMEOUT_MS, failed), { headers });
      case 'findings': {
        const read = await withTimeout(taskFindingsPage(client, appId, taskId, 0), OPTIONAL_LIST_TIMEOUT_MS, failed as FindingsRead).catch((): FindingsRead => failed);
        return json(read, { headers, status: read.kind === 'unavailable' ? 404 : 200 });
      }
      case 'pickers': {
        // An impersonation session writes nothing, so it reads no pickers.
        if (locals.impersonation) return json({ kind: 'ok', value: { workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] } }, { headers });
        const c = await loadWriteCandidates(client, appId);
        return json({ kind: 'ok', value: c }, { headers });
      }
      case 'memories': {
        if (locals.impersonation) return json({ kind: 'ok', value: [] } satisfies MemoriesRead, { headers });
        // portal#1585/#1588: a failed read is a FAILURE value, never [] — "the read failed" must not read as "you can read nothing".
        const read = await fetchAllItems<PickMemory>(client, MEMORIES_QUERY, 'memories').then(
          (memories): MemoriesRead => ({ kind: 'ok', value: memories }),
          (e): MemoriesRead => {
            console.warn('[task-detail] node-picker memory list failed:', e);
            return { kind: 'failed' };
          },
        );
        return json(read, { headers });
      }
    }
  } catch (e) {
    if (isHttpError(e)) throw e;
    return json({ kind: 'failed' }, { headers });
  }
};
