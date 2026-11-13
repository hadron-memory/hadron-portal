import type { GraphQLClient } from 'graphql-request';
import { DISPOSITIONS_MAX_PAGES, DISPOSITIONS_PROVIDER_MAX, parseDispositionPage, type DispositionsRead, type FindingDisposition } from '$lib/agent-tasks/dispositions';
import { AGENT_TASK_FINDING_DISPOSITIONS_QUERY } from './queries';

type Response = { agentTask: { id: string; appId: string; findingDispositions?: unknown } | null };

/**
 * portal#1643 — every current disposition of a task's findings, read under the
 * caller's own client (the viewer's token; no service credential) from the
 * SEPARATE paged `findingDispositions`, 200 a page.
 *
 * The answer is typed so a failed read can never pass for "nothing disposed":
 *  - a null task is the neutral `unavailable` (missing and unreadable are not told apart);
 *  - an empty set is a valid `ok` with no rows;
 *  - a fault, a malformed page, a row repeated across pages, a task of another App, a final page whose rows fall short of (or exceed) the declared total, or a walk
 *    that does not finish inside {@link DISPOSITIONS_MAX_PAGES} pages is `failed`: a partial set
 *    would show a finding as undisposed when it is not.
 * Never throws; never logs a provider message or a finding's text.
 */
export async function taskDispositions(client: GraphQLClient, appId: string, taskId: string): Promise<DispositionsRead> {
  const items: FindingDisposition[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (let page = 0; page < DISPOSITIONS_MAX_PAGES; page++) {
    let response: Response;
    try {
      response = await client.request<Response>(AGENT_TASK_FINDING_DISPOSITIONS_QUERY, { id: taskId, offset: page * DISPOSITIONS_PROVIDER_MAX });
    } catch {
      console.warn('[task-dispositions] read failed');
      return { kind: 'failed' };
    }
    const task = response?.agentTask;
    if (task === null) return { kind: 'unavailable' };
    if (!task || task.id !== taskId || task.appId !== appId) return { kind: 'failed' };
    const parsed = parseDispositionPage(task.findingDispositions);
    if (!parsed) return { kind: 'failed' };
    for (const row of parsed.items) {
      if (seen.has(row.findingId)) return { kind: 'failed' };
      seen.add(row.findingId);
      items.push(row);
    }
    total = parsed.total;
    if (!parsed.hasMore) return items.length === total ? { kind: 'ok', items, total } : { kind: 'failed' };
  }
  return { kind: 'failed' };
}
