import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { AGENT_TASK_DETAIL_QUERY, AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { loadAncestors, loadHistory, loadTree } from '$lib/server/agent-tasks';
import type { AgentTaskDetail } from '$lib/agent-tasks/types';
import type { TasksApp } from '../+page.server';
import type { PageServerLoad } from './$types';

/**
 * portal#1052 — one task: its facts, its subtask tree and its history
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-views §5).
 *
 * `agentTask` answers null for a task that is missing AND for one the caller
 * can't read, so the 404 says both: the server gives no existence oracle and
 * the page doesn't invent one. The tree and history are separate reads that
 * fail independently; the facts still render when either fails.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);

  const [appData, taskData] = await Promise.all([
    client.request<{ app: TasksApp | null }>(AGENT_TASKS_APP_QUERY, { ref: params.appId }),
    client.request<{ agentTask: AgentTaskDetail | null }>(AGENT_TASK_DETAIL_QUERY, { id: params.taskId }),
  ]);
  if (!appData.app) throw error(404, 'App not found');
  const app = appData.app;
  const task = taskData.agentTask;
  if (!task) throw error(404, 'Task not found, or you can’t see it');

  // A task resolves by id alone; one reached under another App's URL moves to
  // its own (the runs/[runId] pattern).
  if (task.appId !== app.id) redirect(303, `/app/apps/${task.appId}/tasks/${task.id}`);

  const [tree, history, crumbs] = await Promise.all([
    loadTree(client, task.id),
    loadHistory(client, app.id, task.id),
    loadAncestors(client, task.parentTaskId),
  ]);

  return {
    app,
    task,
    // The tree's first row is the task itself; the view shows what is below it.
    tree,
    history,
    ancestors: crumbs.ancestors,
    ancestorsTruncated: crumbs.truncated,
  };
};
