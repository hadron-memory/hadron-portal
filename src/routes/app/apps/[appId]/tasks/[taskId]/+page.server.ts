import { readTaskPriority } from '$lib/agent-tasks/planning';
import { error, redirect, isHttpError } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import {
  AGENT_TASK_DETAIL_QUERY,
  SET_AGENT_TASK_PRIORITY_MUTATION,
  ADD_AGENT_TASK_BLOCKER_MUTATION,
  REMOVE_AGENT_TASK_BLOCKER_MUTATION,
  ASSIGN_AGENT_TASK_MUTATION,
  CANCEL_AGENT_TASK_MUTATION,
  DISPOSE_AGENT_TASK_FINDING_MUTATION,
  HAND_BACK_AGENT_TASK_MUTATION,
  MAKE_AGENT_TASK_READY_MUTATION,
  PARK_AGENT_TASK_MUTATION,
  REASSIGN_AGENT_TASK_MUTATION,
  ROLE_TASK_NAME_QUERY,
  UPDATE_AGENT_TASK_MUTATION,
} from '$lib/server/queries';
import { canonicalTaskId, loadAncestors, loadTasksApp, loadTree } from '$lib/server/agent-tasks';
import { TASK_NOT_FOUND_MESSAGE } from '$lib/server/task-not-found';
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
import { readDispositionForm } from '$lib/agent-tasks/dispositions';
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
export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  const client = gqlClient(locals.token);

  // The App first and alone: a viewer it refuses gets the App page's 404
  // before any task read (Uma's P2-2 on #1127).
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  // portal#1349: a handle in the URL is qualified with THIS route's App and
  // forwarded to the server's own resolver; another App's qualified handle is
  // unknown before any task read, same as a task that does not exist.
  const seg = resolveSegment(params.taskId, app.urn);
  if (seg.kind === 'unknown') throw error(404, TASK_NOT_FOUND_MESSAGE);
  const taskData = await client.request<{ agentTask: AgentTaskDetail | null }>(AGENT_TASK_DETAIL_QUERY, { id: seg.ref });
  const task = taskData.agentTask;
  if (!task) throw error(404, TASK_NOT_FOUND_MESSAGE);

  // A task resolves by id alone; one reached under another App's URL moves to
  // its own (the runs/[runId] pattern).
  if (task.appId !== app.id) {
    // #1738 (Refs #1394): wait for the app layout's active-org cookie write before redirecting.
    await parent();
    redirect(303, `/app/apps/${task.appId}/tasks/${encodeURIComponent(task.id)}`);
  }

  // portal#1090: an impersonation session writes nothing, so it gets no bar
  // and no picker read. Everyone else gets the bar; the server decides.
  const canWrite = !locals.impersonation;
  // portal#2261: the first screen only — the task's facts (read above), its subtask tree and the
  // breadcrumb's ancestors. History, Review, Clones, the blocker relations, the findings, the
  // assignee/requirement pickers and the memories list read when they are shown (see ./sections).
  // They run one after the other: one page open never holds more than one pool connection.
  const tree = await loadTree(client, task.id);
  const crumbs = await loadAncestors(client, task.parentTaskId);

  const roleTaskNames = await loadRoleTaskNames(client, task.result?.workedFromRoleTaskRefs);

  return {
    app,
    task,
    // portal#2245: name by node id for the role tasks followed; absent ids show the URN leaf.
    roleTaskNames,
    // The tree's first row is the task itself; the view shows what is below it.
    tree,
    ancestors: crumbs.ancestors,
    ancestorsTruncated: crumbs.truncated,
    canWrite,
    // portal#1571: who is signed in, so Hand back is offered only to the started task's own assignee.
    viewerId: locals.user?.id ?? null,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
    // tasks/new redirects here with ?created=1 (design §6).
    created: url.searchParams.get('created') === '1',
  };
};

/**
 * portal#2245: the live names of the role tasks a finished task followed. The result
 * stores the URN and revision but no name. Each read stands alone and ANY failure (a
 * node the viewer can no longer read, a deleted one, a transport error) leaves that id
 * out, so the row falls back to the URN leaf. No second request asks why, and the page
 * never fails on it. One read per distinct id, all in flight together (they depend on
 * nothing but the refs): at most ten, none when the task has no refs.
 */
async function loadRoleTaskNames(
  client: ReturnType<typeof gqlClient>,
  refs: { nodeId: string }[] | null | undefined,
): Promise<Record<string, string>> {
  const names: Record<string, string> = {};
  const ids = [...new Set((refs ?? []).map((ref) => ref.nodeId))];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const res = await client.request<{ node: { name: string | null } | null }>(ROLE_TASK_NAME_QUERY, { ref: id });
        if (res.node?.name) names[id] = res.node.name;
      } catch {
        /* the fallback is the same for every cause */
      }
    }),
  );
  return names;
}

/**
 * portal#1090 — the task page's writes (design §3, §4). Each calls its own
 * existing mutation; who may is the server's rule
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:09), answered by its typed
 * refusal, which goes back verbatim with the reader's values. Park (portal#1143)
 * is offered on state alone; the same refusal answers anyone outside its audience.
 */
type TaskWrite = 'handBack' | 'ready' | 'assign' | 'reassign' | 'park' | 'edit' | 'cancel' | 'priority' | 'addBlocker' | 'removeBlocker' | 'disposeFinding';

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
  // These writes name the task by `taskRef` (the canonical id); the rest still send `taskId`.
  const takesTaskRef = action === 'handBack' || action === 'disposeFinding' || action === 'priority' || action === 'addBlocker' || action === 'removeBlocker';
  const vars: Record<string, unknown> = { ...(takesTaskRef ? { taskRef: taskId } : { taskId }), ...built.vars };
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
  // portal#1643 (hadron-server#2663): the assigner's decision on one finding. The server decides who may
  // (TASK_NOT_OWNER), and a refusal changes nothing the reader sees.
  disposeFinding: (event) => write('disposeFinding', event, (fd) => {
    const input = readDispositionForm(fd);
    if (!input.ok) return { invalid: { field: input.field, message: input.message } };
    return { doc: DISPOSE_AGENT_TASK_FINDING_MUTATION, path: 'disposeAgentTaskFinding', vars: input.vars };
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
