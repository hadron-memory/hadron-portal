import { taskDependencies } from '$lib/server/task-planning';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import { readTaskPriority } from '$lib/agent-tasks/planning';
import { error, redirect, isHttpError } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import {
  AGENT_TASK_DETAIL_QUERY,
  MEMORIES_QUERY,
  SET_AGENT_TASK_PRIORITY_MUTATION,
  ADD_AGENT_TASK_BLOCKER_MUTATION,
  REMOVE_AGENT_TASK_BLOCKER_MUTATION,
  ASSIGN_AGENT_TASK_MUTATION,
  CANCEL_AGENT_TASK_MUTATION,
  HAND_BACK_AGENT_TASK_MUTATION,
  MAKE_AGENT_TASK_READY_MUTATION,
  PARK_AGENT_TASK_MUTATION,
  REASSIGN_AGENT_TASK_MUTATION,
  UPDATE_AGENT_TASK_MUTATION,
} from '$lib/server/queries';
import { canonicalTaskId, loadAncestors, loadHistory, loadTasksApp, loadTree, loadWriteCandidates } from '$lib/server/agent-tasks';
import {
  classifyWriteError,
  formValues,
  impersonationRefusal,
  parsePartyChoice,
  taskWrite,
  writeFailure,
} from '$lib/server/agent-task-writes';
import { t } from '$lib/i18n/t';
import { resolveSegment } from '$lib/agent-tasks/handle';
import { taskEditPatch } from '$lib/agent-tasks/edit';
import { parseHandBack } from '$lib/agent-tasks/hand-back';
import type { AgentTaskDetail } from '$lib/agent-tasks/types';
import type { MemoriesRead } from '$lib/node-choices';
import type { Actions, PageServerLoad } from './$types';

// portal#1576 step 2: the NODE reference picker's memory rows (see the load).
type PickMemory = { id: string; name: string; urn: string; visibility: string | null };

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
  // portal#1349: a handle in the URL is qualified with THIS route's App and
  // forwarded to the server's own resolver; another App's qualified handle is
  // unknown before any task read, same as a task that does not exist.
  const seg = resolveSegment(params.taskId, app.urn);
  if (seg.kind === 'unknown') throw error(404, 'Task not found, or you can’t see it');
  const taskData = await client.request<{ agentTask: AgentTaskDetail | null }>(AGENT_TASK_DETAIL_QUERY, { id: seg.ref });
  const task = taskData.agentTask;
  if (!task) throw error(404, 'Task not found, or you can’t see it');

  // A task resolves by id alone; one reached under another App's URL moves to
  // its own (the runs/[runId] pattern).
  if (task.appId !== app.id) redirect(303, `/app/apps/${task.appId}/tasks/${encodeURIComponent(task.id)}`);

  // portal#1090: an impersonation session writes nothing, so it gets no bar
  // and no picker read. Everyone else gets the bar; the server decides.
  const canWrite = !locals.impersonation;
  const [tree, history, crumbs, candidates] = await Promise.all([
    loadTree(client, task.id),
    loadHistory(client, app.id, task.id),
    loadAncestors(client, task.parentTaskId),
    canWrite ? loadWriteCandidates(client, app.id) : Promise.resolve({ workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] }),
  ]);

  return {
    app,
    task,
    // portal#1392: the relations are optional; a read that hasn't answered within the
    // optional-list budget becomes the existing unknown state ("reload to try again"),
    // never empty relations. The request itself is not cancelled, only no longer waited for.
    dependencies: await withTimeout(taskDependencies(client, app.id, task.id), OPTIONAL_LIST_TIMEOUT_MS, { kind: 'failed' } as const),
    // The tree's first row is the task itself; the view shows what is below it.
    tree,
    history,
    ancestors: crumbs.ancestors,
    ancestorsTruncated: crumbs.truncated,
    canWrite,
    // portal#1571: who is signed in, so Hand back is offered only to the started task's own assignee.
    viewerId: locals.user?.id ?? null,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
    candidates: { workers: candidates.workers, people: candidates.people, peopleWithheld: candidates.peopleWithheld, peopleFailed: candidates.peopleFailed },
    // portal#1357: the Edit details panel's requirement pickers.
    roles: candidates.roles,
    families: candidates.families,
    // portal#1576 step 2: the NODE reference picker's memory stage — the
    // viewer's readable memories (server-scoped MEMORIES_QUERY, the #512
    // Move-dialog precedent), STREAMED so it never blocks the page. An
    // impersonation session writes nothing, so it reads no list either.
    // portal#1585 (QA P2): a failed read must reach the picker as a FAILURE,
    // never as [] — an empty list made "the read failed" read as "you can
    // read nothing".
    // portal#1588 (QA F2): the failure streams as a VALUE ({kind:'failed'}),
    // never a rejection — a rejecting stream fires an uncaught pageerror
    // during kit's parse-time deserialization, before any component can
    // attach. Warned server-side, the page still loads, the editor branches.
    nodeMemories: canWrite
      ? fetchAllItems<PickMemory>(client, MEMORIES_QUERY, 'memories').then(
          (memories): MemoriesRead => ({ kind: 'ok', value: memories }),
          (e): MemoriesRead => {
            console.warn('[task-detail] node-picker memory list failed:', e);
            return { kind: 'failed' };
          },
        )
      : Promise.resolve({ kind: 'ok', value: [] } as MemoriesRead),
    // tasks/new redirects here with ?created=1 (design §6).
    created: url.searchParams.get('created') === '1',
  };
};

/**
 * portal#1090 — the task page's writes (design §3, §4). Each calls its own
 * existing mutation; who may is the server's rule
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:09), answered by its typed
 * refusal, which goes back verbatim with the reader's values. Park (portal#1143)
 * is offered on state alone; the same refusal answers anyone outside its audience.
 */
type TaskWrite = 'handBack' | 'ready' | 'assign' | 'reassign' | 'park' | 'edit' | 'cancel' | 'priority' | 'addBlocker' | 'removeBlocker';

async function write(
  action: TaskWrite,
  { request, params, locals }: Parameters<Actions[string]>[0],
  build: (fd: FormData) => { doc: string; vars: Record<string, unknown>; path?: string } | { invalid: { field: string; message: string } } | { unchanged: true },
) {
  const fd = await request.formData();
  const values = formValues(fd);
  if (locals.impersonation) return writeFailure(action, impersonationRefusal(), values);
  const built = build(fd);
  if ('invalid' in built) return writeFailure(action, { kind: 'invalid', ...built.invalid }, values);
  // portal#1357: a save that changes nothing asks the server nothing and says so.
  if ('unchanged' in built) return { action, ok: true as const, unchanged: true as const };
  // The mutation identity is the canonical id the server resolved for THIS App's
  // route, never the raw URL segment (portal#1349).
  let taskId: string;
  try {
    taskId = await canonicalTaskId(gqlClient(locals.token), params.appId, params.taskId);
  } catch (e) {
    // The neutral 404 stands; a failed resolution read is the uncertain line, like any write fault.
    if (isHttpError(e)) throw e;
    return writeFailure(action, { kind: 'uncertain' }, values);
  }
  const planning = action === 'handBack' || action === 'priority' || action === 'addBlocker' || action === 'removeBlocker';
  const vars: Record<string, unknown> = { ...(planning ? { taskRef: taskId } : { taskId }), ...built.vars };
  // portal#1214: a write whose response can carry warnings keeps them.
  if (built.path) {
    const out = await taskWrite(gqlClient(locals.token), built.doc, vars, built.path);
    if (out.kind === 'refused') return writeFailure(action, out.refusal, values);
    return { action, ok: true as const, committedWithError: out.kind === 'committed-error', warnings: out.warnings, more: out.more };
  }
  try {
    await gqlClient(locals.token).request(built.doc, vars);
    return { action, ok: true as const };
  } catch (e) {
    return writeFailure(action, classifyWriteError(e), values);
  }
}

/** Assign and reassign: the picked party, and closeSessionWhenDone only when the reader changed it. */
function assignment(doc: string, path: string) {
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
    return { doc, vars, path };
  };
}

function blockerEdit(doc: string, path: string) {
  return (fd: FormData) => {
    const ref = String(fd.get('blockerTaskRef') ?? '').trim();
    if (!ref) return { invalid: { field: 'blockerTaskRef', message: t('app.tasks.blocker.required', 'Choose a task.') } };
    return { doc, path, vars: { blockerTaskRef: ref } };
  };
}

export const actions: Actions = {
  priority: (event) => write('priority', event, (fd) => {
    const priority = readTaskPriority(fd.get('priority'));
    if (typeof priority === 'object') return { invalid: priority };
    if (priority === undefined) return { invalid: { field: 'priority', message: t('app.tasks.priority.required', 'Choose a priority.') } };
    return { doc: SET_AGENT_TASK_PRIORITY_MUTATION, path: 'setAgentTaskPriority', vars: { priority } };
  }),
  addBlocker: (event) => write('addBlocker', event, blockerEdit(ADD_AGENT_TASK_BLOCKER_MUTATION, 'addAgentTaskBlocker')),
  removeBlocker: (event) => write('removeBlocker', event, blockerEdit(REMOVE_AGENT_TASK_BLOCKER_MUTATION, 'removeAgentTaskBlocker')),
  ready: (event) => write('ready', event, () => ({ doc: MAKE_AGENT_TASK_READY_MUTATION, vars: {} })),
  assign: (event) => write('assign', event, assignment(ASSIGN_AGENT_TASK_MUTATION, 'assignAgentTask')),
  reassign: (event) => write('reassign', event, assignment(REASSIGN_AGENT_TASK_MUTATION, 'reassignAgentTask')),
  // portal#1571 (hadron-server#2651): the assignee's reason; the server decides who may and when.
  handBack: (event) => write('handBack', event, (fd) => {
    const reason = parseHandBack(String(fd.get('code') ?? ''), String(fd.get('text') ?? ''));
    if ('invalid' in reason) return reason;
    return { doc: HAND_BACK_AGENT_TASK_MUTATION, vars: { reason } };
  }),
  park: (event) => write('park', event, () => ({ doc: PARK_AGENT_TASK_MUTATION, vars: {} })),
  // portal#1357 (hadron-server#2645): the changed descriptive fields only; the server decides who may.
  edit: (event) => write('edit', event, (fd) => {
    const patch = taskEditPatch(fd);
    if ('invalid' in patch) return patch;
    if (Object.keys(patch.input).length === 0) return { unchanged: true };
    return { doc: UPDATE_AGENT_TASK_MUTATION, path: 'updateAgentTask', vars: { input: patch.input } };
  }),
  cancel: (event) => write('cancel', event, () => ({ doc: CANCEL_AGENT_TASK_MUTATION, vars: {} })),
};
