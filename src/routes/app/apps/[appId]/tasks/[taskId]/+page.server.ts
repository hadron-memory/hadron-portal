import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  AGENT_TASK_DETAIL_QUERY,
  ASSIGN_AGENT_TASK_MUTATION,
  CANCEL_AGENT_TASK_MUTATION,
  MAKE_AGENT_TASK_READY_MUTATION,
  REASSIGN_AGENT_TASK_MUTATION,
} from '$lib/server/queries';
import { loadAncestors, loadHistory, loadTasksApp, loadTree, loadWriteCandidates } from '$lib/server/agent-tasks';
import {
  classifyWriteError,
  formValues,
  impersonationRefusal,
  parsePartyChoice,
  writeFailure,
} from '$lib/server/agent-task-writes';
import { t } from '$lib/i18n/t';
import type { AgentTaskDetail } from '$lib/agent-tasks/types';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1052 — one task: its facts, its subtask tree and its history
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-views §5).
 *
 * `agentTask` answers null for a task that is missing AND for one the caller
 * can't read, so the 404 says both: the server gives no existence oracle and
 * the page doesn't invent one. The tree and history are separate reads that
 * fail independently; the facts still render when either fails.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);

  // The App first and alone: a viewer it refuses gets the App page's 404
  // before any task read (Uma's P2-2 on #1127).
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  const taskData = await client.request<{ agentTask: AgentTaskDetail | null }>(AGENT_TASK_DETAIL_QUERY, { id: params.taskId });
  const task = taskData.agentTask;
  if (!task) throw error(404, 'Task not found, or you can’t see it');

  // A task resolves by id alone; one reached under another App's URL moves to
  // its own (the runs/[runId] pattern).
  if (task.appId !== app.id) redirect(303, `/app/apps/${task.appId}/tasks/${task.id}`);

  // portal#1090: an impersonation session writes nothing, so it gets no bar
  // and no picker read. Everyone else gets the bar; the server decides.
  const canWrite = !locals.impersonation;
  const [tree, history, crumbs, candidates] = await Promise.all([
    loadTree(client, task.id),
    loadHistory(client, app.id, task.id),
    loadAncestors(client, task.parentTaskId),
    canWrite ? loadWriteCandidates(client, app.id) : Promise.resolve({ workers: [], people: [], peopleWithheld: false, roles: [], families: [] }),
  ]);

  return {
    app,
    task,
    // The tree's first row is the task itself; the view shows what is below it.
    tree,
    history,
    ancestors: crumbs.ancestors,
    ancestorsTruncated: crumbs.truncated,
    canWrite,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
    candidates: { workers: candidates.workers, people: candidates.people, peopleWithheld: candidates.peopleWithheld },
    // tasks/new redirects here with ?created=1 (design §6).
    created: url.searchParams.get('created') === '1',
  };
};

/**
 * portal#1090 — the task page's writes (design §3, §4). Each calls its own
 * existing mutation; who may is the server's rule
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:09), answered by its typed
 * refusal, which goes back verbatim with the reader's values. Park is held
 * pending a ruling: there is no park action.
 */
type TaskWrite = 'ready' | 'assign' | 'reassign' | 'cancel';

async function write(
  action: TaskWrite,
  { request, params, locals }: Parameters<Actions[string]>[0],
  build: (fd: FormData) => { doc: string; vars: Record<string, unknown> } | { invalid: { field: string; message: string } },
) {
  const fd = await request.formData();
  const values = formValues(fd);
  if (locals.impersonation) return writeFailure(action, impersonationRefusal(), values);
  const built = build(fd);
  if ('invalid' in built) return writeFailure(action, { kind: 'invalid', ...built.invalid }, values);
  try {
    await gqlClient(locals.token).request(built.doc, { taskId: params.taskId, ...built.vars });
    return { action, ok: true as const };
  } catch (e) {
    return writeFailure(action, classifyWriteError(e), values);
  }
}

/** Assign and reassign: the picked party, and closeSessionWhenDone only when the reader changed it. */
function assignment(doc: string) {
  return (fd: FormData) => {
    const assignee = parsePartyChoice(String(fd.get('assignee') ?? ''), String(fd.get('assigneeOther') ?? ''));
    if (!assignee) {
      return { invalid: { field: 'assignee', message: t('app.tasks.write.assignee-required', 'Choose who to assign it to.') } };
    }
    const was = fd.get('closeSessionWhenDoneWas');
    const now = fd.get('closeSessionWhenDone') === 'on';
    const vars: Record<string, unknown> = { assignee };
    if (was === 'true' || was === 'false') {
      if (now !== (was === 'true')) vars.closeSessionWhenDone = now;
    }
    return { doc, vars };
  };
}

export const actions: Actions = {
  ready: (event) => write('ready', event, () => ({ doc: MAKE_AGENT_TASK_READY_MUTATION, vars: {} })),
  assign: (event) => write('assign', event, assignment(ASSIGN_AGENT_TASK_MUTATION)),
  reassign: (event) => write('reassign', event, assignment(REASSIGN_AGENT_TASK_MUTATION)),
  cancel: (event) => write('cancel', event, () => ({ doc: CANCEL_AGENT_TASK_MUTATION, vars: {} })),
};
