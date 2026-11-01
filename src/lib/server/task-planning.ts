import { composeAgentTaskUrnV2, parseUrnV2 } from '$lib/urn/parse-urn';
import type { GraphQLClient } from 'graphql-request';
import type { TaskChoice, TaskDependencyPage, TaskRead } from '$lib/agent-tasks/types';
import { TASK_DEPENDENCIES_QUERY, TASK_BLOCKED_BY_PAGE_QUERY, TASK_BLOCKS_PAGE_QUERY, TASK_PICKER_EXACT_QUERY, TASK_PICKER_QUERY } from './queries';

export async function taskChoices(client: GraphQLClient, app: { id: string; urn: string }, offset: number, exact?: string): Promise<TaskRead<{ items: TaskChoice[]; hasMore: boolean }>> {
  try {
    if (exact) {
      // A bare handle belongs to this App, never whichever App the principal last used.
      let ref = exact;
      if (/^AT\d+(?:\.\d+)*$/i.test(exact)) {
        const parsed = parseUrnV2(app.urn);
        if (parsed.type !== 'app' || parsed.segments.length !== 1) return { kind: 'failed' };
        ref = composeAgentTaskUrnV2(parsed.root, parsed.segments[0], exact.toUpperCase());
      }
      const { agentTask } = await client.request<{ agentTask: TaskChoice | null }>(TASK_PICKER_EXACT_QUERY, { id: ref });
      if (!agentTask || agentTask.appId !== app.id || !['BACKLOG', 'PENDING', 'STARTED'].includes(agentTask.status) || agentTask.handle === 'AT0') return { kind: 'ok', value: { items: [], hasMore: false } };
      return { kind: 'ok', value: { items: [agentTask], hasMore: false } };
    }
    const { agentTasks } = await client.request<{ agentTasks: TaskChoice[] }>(TASK_PICKER_QUERY, { appRef: app.id, offset });
    // Never expose a foreign row, even if a faulty or skewed transport returns one.
    if (agentTasks.some((task) => task.appId !== app.id)) return { kind: 'failed' };
    // cf9bcfec resolvers.agentTask.agentTasks returns Prisma take/skip directly,
    // without post-filtering. A short raw page is exhausted at this snapshot.
    return { kind: 'ok', value: { items: agentTasks, hasMore: agentTasks.length === 200 } };
  } catch { return { kind: 'failed' }; }
}

export async function taskDependencies(client: GraphQLClient, appId: string, taskId: string): Promise<TaskRead<{ blockedBy: TaskDependencyPage; blocks: TaskDependencyPage }>> {
  try {
    const { agentTask } = await client.request<{ agentTask: { id: string; appId: string; blockedBy: TaskDependencyPage; blocks: TaskDependencyPage } | null }>(TASK_DEPENDENCIES_QUERY, { id: taskId, offset: 0 });
    if (!agentTask || agentTask.id !== taskId || agentTask.appId !== appId) return { kind: 'failed' };
    if ([...agentTask.blockedBy.items, ...agentTask.blocks.items].some((task) => task.appId !== appId)) return { kind: 'failed' };
    return { kind: 'ok', value: { blockedBy: agentTask.blockedBy, blocks: agentTask.blocks } };
  } catch { return { kind: 'failed' }; }
}

/** One provider page, not a whole-graph scan or a client-inferred count. */
export async function taskDependencyPage(client: GraphQLClient, appId: string, taskId: string, direction: 'blockedBy' | 'blocks', offset: number): Promise<TaskRead<TaskDependencyPage>> {
  try {
    type Response = { agentTask: { id: string; appId: string; blockedBy?: TaskDependencyPage; blocks?: TaskDependencyPage } | null };
    const { agentTask } = direction === 'blockedBy'
      ? await client.request<Response>(TASK_BLOCKED_BY_PAGE_QUERY, { id: taskId, offset })
      : await client.request<Response>(TASK_BLOCKS_PAGE_QUERY, { id: taskId, offset });
    const page = agentTask?.[direction];
    if (!agentTask || agentTask.id !== taskId || agentTask.appId !== appId || !page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean' || page.items.length > 200 || page.items.some((task) => task.appId !== appId)) return { kind: 'failed' };
    return { kind: 'ok', value: page };
  } catch { return { kind: 'failed' }; }
}
