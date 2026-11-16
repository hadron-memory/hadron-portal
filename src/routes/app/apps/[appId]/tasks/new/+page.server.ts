import { readTaskPriority } from '$lib/agent-tasks/planning';
import { error, isHttpError, redirect } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import {
  AGENT_TASK_CLONE_PARENT_QUERY,
  AGENT_TASK_DETAIL_QUERY,
  CLONE_AGENT_TASK_MUTATION,
  CREATE_AGENT_TASK_MUTATION,
  MEMORIES_QUERY,
} from '$lib/server/queries';
import { canonicalTaskId, loadTasksApp, loadWriteCandidates } from '$lib/server/agent-tasks';
import {
  formValues,
  impersonationRefusal,
  parsePartyChoice,
  taskWrite,
  writeFailure,
  type TaskWriteOutcome,
} from '$lib/server/agent-task-writes';
import { t } from '$lib/i18n/t';
import { isProjectZero, parseHandle, resolveSegment, taskHref } from '$lib/agent-tasks/handle';
import { startByIso } from '$lib/agent-tasks/start-by';
import { readReferences, referenceInput } from '$lib/agent-tasks/references';
import { taskClonePatch } from '$lib/agent-tasks/clone';
import type { WriteRefusal } from '$lib/agent-tasks/actions';
import type { AgentTaskDetail } from '$lib/agent-tasks/types';
import type { MemoriesRead } from '$lib/node-choices';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1090 — create a root task
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-writes §6).
 * Root only: a subtask is created by its parent's assignee (hrn:node:hadronmemory.com:specs:cor:agt:050:07),
 * a later slice. A page, not a modal, so it is linkable and a refusal keeps
 * the form.
 *
 * portal#2161 (hadron-server#3244): with `?from=<id|handle>` the same page is the Clone form,
 * pre-filled with what the copy will actually get (never a value the server won't copy), and its
 * save calls `cloneAgentTask`, never `createAgentTask`.
 */
export const load: PageServerLoad = async ({ params, locals, url, parent }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  const canWrite = !locals.impersonation;
  const c = canWrite ? await loadWriteCandidates(client, app.id) : { workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] };
  // portal#1576 step 2: the NODE picker's memory stage — every memory the
  // viewer can read (MEMORIES_QUERY is server-scoped to the caller, the #512
  // Move-dialog precedent). STREAMED, not awaited: it never blocks the form.
  // portal#1585 (QA P2): a failed read must reach the picker as a FAILURE,
  // never as [] — resolving to an empty list made "the read failed"
  // indistinguishable from "you can read nothing".
  // portal#1588 (QA F2): the failure streams as a VALUE ({kind:'failed'}),
  // never a rejection — a rejecting stream fires an uncaught pageerror
  // during kit's parse-time deserialization, before any component can
  // attach. Warned server-side (the log is the only trace), the page still
  // loads, and the editor branches on the value.
  // An impersonation session writes nothing, so it reads no list either
  // (the task-detail loader's rule): its page renders no editor, so the
  // fan-out could never be consumed.
  type PickMemory = { id: string; name: string; urn: string; visibility: string | null };
  const nodeMemories: Promise<MemoriesRead> = canWrite
    ? fetchAllItems<PickMemory>(client, MEMORIES_QUERY, 'memories').then(
        (memories): MemoriesRead => ({ kind: 'ok', value: memories }),
        (e) => {
          console.warn('[tasks-new] node-picker memory list failed:', e);
          return { kind: 'failed' };
        },
      )
    : Promise.resolve({ kind: 'ok', value: [] });

  // portal#2161: the clone source resolves like the detail page's task (portal#1349) — a handle is
  // qualified with THIS App, and unknown, unreadable and cross-App alike answer the neutral 404.
  // A task of another App moves to its own App's clone URL (the detail page's redirect pattern).
  let clone: ClonePrefill | null = null;
  const fromRaw = url.searchParams.get('from');
  if (fromRaw) {
    const seg = resolveSegment(fromRaw, app.urn);
    if (seg.kind === 'unknown') throw error(404, 'Task not found, or you can’t see it');
    const srcData = await client.request<{ agentTask: AgentTaskDetail | null }>(AGENT_TASK_DETAIL_QUERY, { id: seg.ref });
    const src = srcData.agentTask;
    if (!src) throw error(404, 'Task not found, or you can’t see it');
    if (src.appId !== app.id) {
      // #1738 (Refs #1394): wait for the app layout's active-org cookie write before redirecting.
      await parent();
      redirect(303, `/app/apps/${src.appId}/tasks/new?from=${encodeURIComponent(src.id)}`);
    }
    clone = await clonePrefill(client, src);
  }

  return {
    clone,
    app,
    canWrite,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
    candidates: { workers: c.workers, people: c.people, peopleWithheld: c.peopleWithheld, peopleFailed: c.peopleFailed },
    roles: c.roles,
    families: c.families,
    nodeMemories,
  };
};

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const list = (fd: FormData, k: string) => fd.getAll(k).map((v) => String(v).trim()).filter(Boolean);

/**
 * portal#2161: what the Clone form opens with. `values` are both the seeds the inputs show and
 * the BASES the save diffs against (each copied field posts `…Base` beside it, as on the Edit
 * details form); `parent` is the parent the server will actually keep — its `choice` is the
 * vocabulary the form posts as `cloneParent` / `cloneParentBase`.
 */
type ClonePrefill = {
  source: { id: string; handle: string; title: string };
  parent: {
    choice: 'none' | 'project' | `parent:${string}`;
    task: { id: string; handle: string; title: string } | null;
  };
  values: {
    title: string;
    description: string;
    source: string;
    tags: string;
    closeSessionWhenDone: boolean;
    priority: number | null;
    references: string;
    requirements: string;
  };
};

/**
 * The parent the server keeps on a clone (its `cloneAgentTask`): the source's own only while it
 * is not AT0 and has not ended — an ended or AT0 parent falls back to AT0, so "No project" is
 * the truthful pre-fill, never the ended parent. A root source clones as a project. A parent
 * this caller can't read stays named (the server decides by its own row), shown as opaque.
 */
async function clonePrefill(client: GraphQLClient, src: AgentTaskDetail): Promise<ClonePrefill> {
  let choice: ClonePrefill['parent']['choice'] = 'project';
  let task: ClonePrefill['parent']['task'] = null;
  if (src.parentTaskId) {
    const p = await client.request<{ agentTask: { id: string; handle: string; title: string; status: string } | null }>(
      AGENT_TASK_CLONE_PARENT_QUERY,
      { id: src.parentTaskId },
    );
    const parent = p.agentTask;
    if (!parent) {
      choice = `parent:${src.parentTaskId}`;
    } else if (!isProjectZero(parent.handle) && parent.status !== 'FINISHED' && parent.status !== 'CANCELLED') {
      choice = `parent:${parent.id}`;
      task = { id: parent.id, handle: parent.handle, title: parent.title };
    } else {
      choice = 'none';
    }
  }
  const rq = src.requirements;
  return {
    source: { id: src.id, handle: src.handle, title: src.title },
    parent: { choice, task },
    values: {
      title: src.title,
      description: src.description ?? '',
      source: src.source ?? '',
      tags: src.tags.join(', '),
      closeSessionWhenDone: src.closeSessionWhenDone,
      priority: src.priority ?? null,
      references: JSON.stringify((src.references ?? []).map((r) => ({ kind: r.kind, target: r.target, label: r.label ?? null }))),
      requirements: JSON.stringify({
        role: rq?.role ?? null,
        familyIn: rq?.familyIn ?? [],
        familyNotIn: rq?.familyNotIn ?? [],
        excludeWorkers: rq?.excludeWorkerIds ?? [],
        minTier: rq?.minTier ?? null,
      }),
    },
  };
}

/**
 * portal#2161 Ask 3: the clone refusals in plain words, each naming the remedy the form offers.
 * TASK_NOT_FOUND is exactly "Task not found" — unknown, unreadable and cross-App sources and
 * parents alike (no existence oracle), so no reason is given. Every other code (a clone runs
 * every create gate) renders the server's own message, verbatim.
 */
function cloneRefusal(r: WriteRefusal): WriteRefusal {
  if (r.kind !== 'refused') return r;
  switch (r.code) {
    case 'TASK_NOT_ASSIGNEE':
      return { ...r, message: t('app.tasks.clone.refusal.parent', 'The parent can’t be kept: you can’t create a task under it. Choose another parent, or none.') };
    case 'TASK_ENDED':
      return { ...r, message: t('app.tasks.clone.refusal.parent-ended', 'The parent you chose has ended. Choose another parent, or none.') };
    case 'TASK_NOT_OWNER':
      return { ...r, message: t('app.tasks.clone.refusal.priority', 'You can’t set that priority. Leave it copied, or choose one you may set.') };
    case 'TASK_NOT_FOUND':
      return { ...r, message: t('app.tasks.clone.refusal.not-found', 'Task not found') };
    default:
      return r;
  }
}

/**
 * portal#2161: save the Clone form. The input carries only what the person changed against the
 * pre-filled bases (taskClonePatch) plus the create-only choices — owner, assignee, status,
 * start-by — exactly as on a plain create; nothing else is copied from the form. The source id
 * is re-resolved canonically for THIS App, like every task write (portal#1349).
 */
async function cloneTask(fd: FormData, values: Record<string, string | string[]>, client: GraphQLClient, appId: string) {
  let sourceId: string;
  try {
    sourceId = await canonicalTaskId(client, appId, str(fd, 'from'));
  } catch (e) {
    // The source went missing or unreadable between the form's load and its save (George's F1
    // on portal#2161): the Ask-3 refusal, never a page-level 404 — the person keeps the
    // form and every value they typed, with the neutral "Task not found" (no existence
    // oracle). Any other fault is the uncertain line, like any write's resolution read.
    if (isHttpError(e) && e.status === 404) {
      return writeFailure('clone', cloneRefusal({ kind: 'refused', code: 'TASK_NOT_FOUND', message: 'Task not found' }), values);
    }
    return writeFailure('clone', { kind: 'uncertain' }, values);
  }

  const patch = taskClonePatch(fd);
  if ('invalid' in patch) return writeFailure('clone', { kind: 'invalid', ...patch.invalid }, values);
  const input = patch.input;

  const backlog = str(fd, 'start') === 'backlog';
  if (backlog) input.status = 'BACKLOG';

  // Owner and assignee are not copied: they are chosen exactly as on a plain create.
  const partyRefusal = partyChoices(fd, input, backlog, 'clone', values);
  if (partyRefusal) return partyRefusal;

  // Like the edit: an empty start-by is unchosen (sent as nothing); only a value that
  // doesn't parse once one is posted is refused on its field.
  const startByLocal = str(fd, 'startBy');
  const startByUtc = str(fd, 'startByUtc');
  if (startByLocal || startByUtc) {
    const startBy = startByIso(startByLocal, startByUtc);
    if (startBy === null) {
      return writeFailure('clone', { kind: 'invalid', field: 'startBy', message: t('app.tasks.edit.start-by-invalid', 'Choose a valid start-by date and time, or clear it.') }, values);
    }
    if (startBy) input.startBy = startBy;
  }

  const out = await taskWrite<{ cloneAgentTask: { id: string; handle?: string | null } | null }>(
    client,
    CLONE_AGENT_TASK_MUTATION,
    { taskId: sourceId, input },
    'cloneAgentTask',
  );
  return createdResult('clone', out, (d) => d?.cloneAgentTask, `/app/apps/${appId}`, values, cloneRefusal, { cloned: true });
}

/**
 * The party choices a create and a clone read exactly alike: an explicit "Someone else…" with
 * nothing typed is refused on its field (Diego's P2-2 on #1135); `me`/`nobody`/empty names no
 * party — the create's owner defaults to the creator, the clone's to the cloner — and an assignee
 * goes on a matcher run only. A backlog task takes no assignee: its hidden fields are ignored,
 * not sent to be refused.
 */
function partyChoices(
  fd: FormData,
  input: Record<string, unknown>,
  backlog: boolean,
  action: 'create' | 'clone',
  values: Record<string, string | string[]>,
): ReturnType<typeof writeFailure> | undefined {
  if (explicitBlank(fd, 'owner')) {
    return writeFailure(action, { kind: 'invalid', field: 'owner', message: t('app.tasks.write.other-required', 'Type their @handle or id, or choose someone from the list.') }, values);
  }
  if (!backlog && explicitBlank(fd, 'assignee')) {
    return writeFailure(action, { kind: 'invalid', field: 'assignee', message: t('app.tasks.write.other-required', 'Type their @handle or id, or choose someone from the list.') }, values);
  }
  const owner = parsePartyChoice(str(fd, 'owner'), str(fd, 'ownerOther'));
  if (owner) input.owner = owner;
  if (!backlog) {
    const assignee = parsePartyChoice(str(fd, 'assignee'), str(fd, 'assigneeOther'));
    if (assignee) input.assignee = assignee;
  }
}

/**
 * The outcome a create and a clone share (portal#1214, portal#1349): a refusal keeps the form
 * with its values; a write with nothing to show redirects to the new task's page; warnings, or a
 * committed write whose response errored, are shown in the same response in place of the form. A
 * write with no usable id and nothing to prove it is unknown, never failed.
 */
function createdResult<D>(
  action: 'create' | 'clone',
  out: TaskWriteOutcome<D>,
  row: (data: D | Partial<D> | null) => { id?: string | null; handle?: string | null } | null | undefined,
  basePath: string,
  values: Record<string, string | string[]>,
  refusal: (r: WriteRefusal) => WriteRefusal,
  extra: { cloned?: boolean } = {},
) {
  if (out.kind === 'refused') return writeFailure(action, refusal(out.refusal), values);
  const created = row(out.data);
  const id = taskId(created?.id);
  // portal#1349: the link carries the immutable handle when the server returned a valid one.
  const rawHandle = created?.handle;
  const handle = typeof rawHandle === 'string' && parseHandle(rawHandle) ? rawHandle : null;

  // portal#1214: a write with nothing to show goes straight to the new task's page.
  if (out.kind === 'ok' && out.warnings.length === 0 && out.more === 0) {
    if (id) redirect(303, `${taskHref(basePath, { id, handle })}?created=1`);
    // No usable id and no warning to prove the write: the outcome is unknown.
    if (!out.committed) return writeFailure(action, { kind: 'uncertain' }, values);
  }
  return {
    created: { id, handle },
    ...extra,
    committedWithError: out.kind === 'committed-error',
    warnings: out.warnings,
    more: out.more,
  };
}

/**
 * Diego's P2-2 on #1135: "Someone else…" with nothing usable typed is not a
 * default. Only `me` (owner) or `nobody` (assignee) mean "no party"; an
 * explicit choice that names nobody is refused on its field.
 */
function explicitBlank(fd: FormData, field: 'owner' | 'assignee'): boolean {
  return str(fd, field) === 'other' && !str(fd, `${field}Other`).replace(/^@/, '').trim();
}

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const values = formValues(fd);
    if (locals.impersonation) return writeFailure('create', impersonationRefusal(), values);

    // A plain create's empty title is refused before any server I/O (the clone branch below
    // resolves its source first, so it reads the App before it can judge anything).
    const from = str(fd, 'from');
    if (!from) {
      const title = str(fd, 'title');
      if (!title) {
        return writeFailure('create', { kind: 'invalid', field: 'title', message: t('app.tasks.write.title-required', 'Give the task a title.') }, values);
      }
    }

    const client = gqlClient(locals.token);
    const app = await loadTasksApp(client, params.appId);
    if (!app) throw error(404, 'App not found');

    // portal#2161: a `from` field means the Clone form — its own write, never createAgentTask,
    // so the server keeps the clone link and applies its own copy rules.
    if (from) return cloneTask(fd, values, client, app.id);

    const title = str(fd, 'title');

    const backlog = str(fd, 'start') === 'backlog';
    const input: Record<string, unknown> = { appRef: app.id, title };
    const priority = readTaskPriority(fd.get('priority'));
    if (typeof priority === 'object') return writeFailure('create', { kind: 'invalid', ...priority }, values);
    if (priority !== undefined) input.priority = priority;
    const blockedBy = fd.getAll('blockedBy').filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (blockedBy.length) input.blockedBy = blockedBy;

    const description = str(fd, 'description');
    if (description) input.description = description;
    if (backlog) input.status = 'BACKLOG';

    const partyRefusal = partyChoices(fd, input, backlog, 'create', values);
    if (partyRefusal) return partyRefusal;

    // A backlog task takes no assignee and isn't matched (hrn:node:hadronmemory.com:specs:cor:agt:050:02), so
    // the hidden fields are ignored rather than sent to be refused.
    if (!backlog) {
      const assignee = parsePartyChoice(str(fd, 'assignee'), str(fd, 'assigneeOther'));
      if (assignee) {
        input.assignee = assignee;
      } else {
        const requirements: Record<string, unknown> = {};
        const role = str(fd, 'role');
        if (role) requirements.role = role;
        const familyIn = list(fd, 'familyIn');
        const familyNotIn = list(fd, 'familyNotIn');
        // The server takes one list or the other.
        if (familyIn.length) requirements.familyIn = familyIn;
        else if (familyNotIn.length) requirements.familyNotIn = familyNotIn;
        const exclude = list(fd, 'excludeWorkers');
        if (exclude.length) requirements.excludeWorkers = exclude;
        // portal#1523: "Any" posts nothing; the server owns what a tier means and refuses a bad one.
        const minTier = str(fd, 'minTier');
        if (minTier) requirements.minTier = minTier;
        if (Object.keys(requirements).length) input.requirements = requirements;
      }
    }

    const startBy = startByIso(str(fd, 'startBy'), str(fd, 'startByUtc'));
    if (startBy) input.startBy = startBy;
    const source = str(fd, 'source');
    if (source) input.source = source;
    const tags = str(fd, 'tags').split(',').map((x) => x.trim()).filter(Boolean);
    if (tags.length) input.tags = tags;
    input.closeSessionWhenDone = fd.get('closeSessionWhenDone') === 'on';
    // portal#1575: the ordered list, when there is one. The server refuses what it won't store, naming the position.
    if (fd.has('references')) {
      const references = readReferences(fd.get('references'));
      if (!references) {
        return writeFailure('create', { kind: 'invalid', field: 'references', message: t('app.tasks.edit.references-unreadable', 'The references couldn’t be read. Reload the page and try again.') }, values);
      }
      if (references.length) input.references = references.map(referenceInput);
    }

    const out = await taskWrite<{ createAgentTask: { id: string; handle?: string | null } | null }>(client, CREATE_AGENT_TASK_MUTATION, { input }, 'createAgentTask');
    return createdResult('create', out, (d) => d?.createAgentTask, `/app/apps/${app.id}`, values, (r) => r);
  },
};

/** A returned task id the page may build a link from; anything else links to the Tasks list instead. */
function taskId(x: unknown): string | null {
  return typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x) ? x : null;
}
