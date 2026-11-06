import type { GraphQLClient } from 'graphql-request';
import { parseTaskFindingPage, TASK_FINDINGS_PAGE_SIZE, type TaskFindingsRead } from '$lib/agent-tasks/findings';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { AGENT_TASK_FINDINGS_QUERY } from '$lib/server/queries';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';

const UNAVAILABLE = new Set(['FORBIDDEN', 'NOT_FOUND', 'TASK_NOT_FOUND', 'APP_NOT_FOUND']);

type FindingsAnswer = {
  agentTask: {
    id: string;
    result: { findings: unknown } | null;
  } | null;
};

/** One immutable page through the task result's existing read gate. */
export async function loadTaskFindings(
  client: GraphQLClient,
  taskId: string,
  offset: number,
): Promise<TaskFindingsRead> {
  try {
    const answer = await client.request<FindingsAnswer>(AGENT_TASK_FINDINGS_QUERY, {
      id: taskId,
      limit: TASK_FINDINGS_PAGE_SIZE,
      offset,
    });
    if (!answer.agentTask) return { kind: 'unavailable' };
    if (answer.agentTask.id !== taskId) return { kind: 'failed' };
    if (answer.agentTask.result === null) return { kind: 'no-result' };
    const value = parseTaskFindingPage(answer.agentTask.result.findings, { taskId, offset });
    if (!value) {
      console.warn(`[task-findings] malformed page for ${taskId} at ${offset}`);
      return { kind: 'failed' };
    }
    return { kind: 'page', value };
  } catch (e) {
    if (UNAVAILABLE.has(extractGqlErrorCode(e) ?? '')) return { kind: 'unavailable' };
    console.warn(`[task-findings] read for ${taskId} at ${offset} failed:`, e);
    return { kind: 'failed' };
  }
}

/**
 * The detail page's optional stream always resolves to a typed value. A null
 * result performs no read; a fault or an over-budget read is not an empty page.
 */
export function streamTaskFindings(
  client: GraphQLClient,
  task: { id: string; result: unknown | null },
): Promise<TaskFindingsRead> {
  if (task.result === null) return Promise.resolve({ kind: 'no-result' });
  return withTimeout(loadTaskFindings(client, task.id, 0), OPTIONAL_LIST_TIMEOUT_MS, { kind: 'failed' } as const)
    .catch((e: unknown): TaskFindingsRead => {
      console.warn(`[task-findings] initial read for ${task.id} failed:`, e);
      return { kind: 'failed' };
    });
}
