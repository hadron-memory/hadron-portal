import type { GraphQLClient } from 'graphql-request';
import { FINDINGS_PAGE_SIZE, parseFindingsPage, type FindingsRead } from '$lib/agent-tasks/findings';
import { AGENT_TASK_FINDINGS_QUERY } from './queries';

type FindingsResponse = { agentTask: { id: string; appId: string; result: { findings?: unknown } | null } | null };

/**
 * portal#1637 — one page of a task's findings, under the caller's own client
 * (the viewer's token; no service credential). The answer is typed so a failed
 * read can never pass for an empty one:
 *
 *  - a null task is the neutral `unavailable` (missing and unreadable are not told apart);
 *  - a null result is `no-result`, a finished legacy result with no findings is a valid ZERO page;
 *  - a provider without the field (a GraphQL error), a fault, a malformed page, or a row from
 *    another task/App is `failed`.
 * Never throws; never puts a provider message or finding text in what it returns or logs.
 */
export async function taskFindingsPage(client: GraphQLClient, appId: string, taskId: string, offset: number): Promise<FindingsRead> {
  let response: FindingsResponse;
  try {
    response = await client.request<FindingsResponse>(AGENT_TASK_FINDINGS_QUERY, { ref: taskId, limit: FINDINGS_PAGE_SIZE, offset });
  } catch {
    console.warn('[task-findings] read failed');
    return { kind: 'failed' };
  }
  const task = response?.agentTask;
  if (task === null) return { kind: 'unavailable' };
  if (!task || task.id !== taskId || task.appId !== appId) return { kind: 'failed' };
  if (task.result === null) return { kind: 'no-result' };
  const page = task.result ? parseFindingsPage(task.result.findings) : null;
  if (!page) return { kind: 'failed' };
  return { kind: 'page', page: { taskId, offset, ...page } };
}
