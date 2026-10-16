import { error, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { CREATE_AGENT_TASK_MUTATION } from '$lib/server/queries';
import { loadTasksApp, loadWriteCandidates } from '$lib/server/agent-tasks';
import {
  classifyWriteError,
  formValues,
  impersonationRefusal,
  parsePartyChoice,
  writeFailure,
} from '$lib/server/agent-task-writes';
import { t } from '$lib/i18n/t';
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
  const c = canWrite ? await loadWriteCandidates(client, app.id) : { workers: [], people: [], roles: [], families: [] };
  return {
    app,
    canWrite,
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
    candidates: { workers: c.workers, people: c.people },
    roles: c.roles,
    families: c.families,
  };
};

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const list = (fd: FormData, k: string) => fd.getAll(k).map((v) => String(v).trim()).filter(Boolean);

/**
 * A `datetime-local` value read in the browser's zone: `tzOffset` is the
 * browser's `getTimezoneOffset()` (minutes behind UTC), set when the page
 * runs. Without it the time is read as UTC, which the form says.
 */
function startByIso(local: string, tzOffset: string): string | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m) return null;
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const offset = /^-?\d+$/.test(tzOffset) ? Number(tzOffset) : 0;
  return new Date(utc + offset * 60_000).toISOString();
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
    const description = str(fd, 'description');
    if (description) input.description = description;
    if (backlog) input.status = 'BACKLOG';

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
        if (Object.keys(requirements).length) input.requirements = requirements;
      }
    }

    const startBy = startByIso(str(fd, 'startBy'), str(fd, 'tzOffset'));
    if (startBy) input.startBy = startBy;
    const source = str(fd, 'source');
    if (source) input.source = source;
    const tags = str(fd, 'tags').split(',').map((x) => x.trim()).filter(Boolean);
    if (tags.length) input.tags = tags;
    input.closeSessionWhenDone = fd.get('closeSessionWhenDone') === 'on';

    let id: string;
    try {
      const r = await client.request<{ createAgentTask: { id: string } }>(CREATE_AGENT_TASK_MUTATION, { input });
      id = r.createAgentTask.id;
    } catch (e) {
      return writeFailure('create', classifyWriteError(e), values);
    }
    redirect(303, `/app/apps/${app.id}/tasks/${id}?created=1`);
  },
};
