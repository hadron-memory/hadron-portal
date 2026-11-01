import { readTaskPriority } from '$lib/agent-tasks/planning';
import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { CREATE_AGENT_TASK_MUTATION } from '$lib/server/queries';
import { loadTasksApp, loadWriteCandidates } from '$lib/server/agent-tasks';
import {
  formValues,
  impersonationRefusal,
  parsePartyChoice,
  taskWrite,
  writeFailure,
} from '$lib/server/agent-task-writes';
import { t } from '$lib/i18n/t';
import { parseHandle, taskHref } from '$lib/agent-tasks/handle';
import { startByIso } from '$lib/agent-tasks/start-by';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1090 — create a root task
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-writes §6).
 * Root only: a subtask is created by its parent's assignee (hrn:node:hadronmemory.com:specs:cor:agt:050:07),
 * a later slice. A page, not a modal, so it is linkable and a refusal keeps
 * the form.
 */
export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  const canWrite = !locals.impersonation;
  const c = canWrite ? await loadWriteCandidates(client, app.id) : { workers: [], people: [], peopleWithheld: false, peopleFailed: false, roles: [], families: [] };
  return {
    app,
    canWrite,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
    candidates: { workers: c.workers, people: c.people, peopleWithheld: c.peopleWithheld, peopleFailed: c.peopleFailed },
    roles: c.roles,
    families: c.families,
  };
};

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const list = (fd: FormData, k: string) => fd.getAll(k).map((v) => String(v).trim()).filter(Boolean);

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

    const title = str(fd, 'title');
    if (!title) {
      return writeFailure('create', { kind: 'invalid', field: 'title', message: t('app.tasks.write.title-required', 'Give the task a title.') }, values);
    }

    const client = gqlClient(locals.token);
    const app = await loadTasksApp(client, params.appId);
    if (!app) throw error(404, 'App not found');

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

    if (explicitBlank(fd, 'owner')) {
      return writeFailure('create', { kind: 'invalid', field: 'owner', message: t('app.tasks.write.other-required', 'Type their @handle or id, or choose someone from the list.') }, values);
    }
    if (!backlog && explicitBlank(fd, 'assignee')) {
      return writeFailure('create', { kind: 'invalid', field: 'assignee', message: t('app.tasks.write.other-required', 'Type their @handle or id, or choose someone from the list.') }, values);
    }

    const owner = parsePartyChoice(str(fd, 'owner'), str(fd, 'ownerOther'));
    if (owner) input.owner = owner; // "me" names no owner: the server makes the creator the owner.

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

    const out = await taskWrite<{ createAgentTask: { id: string; handle?: string | null } | null }>(client, CREATE_AGENT_TASK_MUTATION, { input }, 'createAgentTask');
    if (out.kind === 'refused') return writeFailure('create', out.refusal, values);
    const id = taskId(out.data?.createAgentTask?.id);
    // portal#1349: the link carries the immutable handle when the server returned a valid one.
    const rawHandle = out.data?.createAgentTask?.handle;
    const handle = typeof rawHandle === 'string' && parseHandle(rawHandle) ? rawHandle : null;

    // portal#1214: a create with nothing to show goes to its page, as before.
    if (out.kind === 'ok' && out.warnings.length === 0 && out.more === 0) {
      if (id) redirect(303, `${taskHref(`/app/apps/${app.id}`, { id, handle })}?created=1`);
      // No usable id and no warning to prove the write: the outcome is unknown.
      if (!out.committed) return writeFailure('create', { kind: 'uncertain' }, values);
    }
    // Warnings, or a committed write whose response errored: shown here, in the
    // same response, in place of the form. Nothing crosses a request.
    return {
      created: { id, handle },
      committedWithError: out.kind === 'committed-error',
      warnings: out.warnings,
      more: out.more,
    };
  },
};

/** A returned task id the page may build a link from; anything else links to the Tasks list instead. */
function taskId(x: unknown): string | null {
  return typeof x === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(x) ? x : null;
}
