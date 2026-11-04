import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadSchedules, updateSchedule } from '$lib/server/automation-schedule';
import { loadAutomationApproval } from '$lib/server/automation-approval';
import { loadNodeMemories } from '$lib/server/node-memories';
import { updateScheduleInput } from '$lib/automation/schedule-write';
import { parseTimingForm } from '$lib/automation/schedule-form';
import { refusalText } from '$lib/automation/schedule-refusal';
import { approvalHref } from '$lib/automation/approval';
import { timingFromSchedule } from '$lib/automation/schedule-timing';
import { t } from '$lib/i18n/t';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1701 — change a schedule's name, what it runs, or when. Only a schedule has this page. The portal adds no
 * access gate: editing needs the organization admin who created the schedule, and the server's refusal comes back
 * in plain words. The action re-reads the stored schedule instead of trusting anything the form carries about it,
 * and sends only what changed (see schedule-write.ts).
 */

function scheduleOr404(kind: string) {
  if (kind !== 'schedule') throw error(404, 'Automation not found');
}

async function storedSchedule(client: ReturnType<typeof gqlClient>, appId: string, id: string) {
  const { schedules } = await loadSchedules(client, appId);
  return schedules.find((s) => s.id === id) ?? null;
}

export const load: PageServerLoad = async ({ params, locals }) => {
  scheduleOr404(params.kind);
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  // A reader the server will not show schedules to, and a schedule that is not there, look the same.
  const schedule = await storedSchedule(client, app.id, params.ref);
  if (!schedule) throw error(404, 'Schedule not found');
  return {
    app,
    ref: params.ref,
    schedule,
    timing: timingFromSchedule(schedule),
    nodeMemories: loadNodeMemories(client, 'edit-schedule'),
  };
};

type Field = 'entry' | 'name' | 'when' | 'hours' | 'time' | 'days' | 'date';
const failed = (status: number, field: Field, message: string) => fail(status, { failure: { field, message } });

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    scheduleOr404(params.kind);
    const form = await request.formData();
    const text = (k: string) => String(form.get(k) ?? '').trim();

    const entryNodeUrn = text('entryNodeUrn');
    if (!entryNodeUrn) return failed(400, 'entry', t('app.automations.form.err.entry', 'Choose what should run.'));
    const name = text('name');
    if (!name) return failed(400, 'name', t('app.automations.form.err.name', 'Give the schedule a name.'));

    const client = gqlClient(locals.token);
    const app = await loadTasksApp(client, params.appId);
    if (!app) throw error(404, 'App not found');
    const stored = await storedSchedule(client, app.id, params.ref);
    if (!stored) return failed(404, 'name', refusalText('edit', 'not-found'));

    // Timing the user did not ask to change stays exactly as stored; new timing is read in the schedule's own zone.
    let timing = null;
    if (form.get('keepTiming') !== '1') {
      const parsed = parseTimingForm(form, stored.timezone);
      if (!parsed.ok) return failed(400, parsed.field, parsed.message);
      timing = parsed.timing;
    }

    const input = updateScheduleInput(stored, { name, entryNodeUrn, timing });
    if (Object.keys(input).length === 0) return { nothingToChange: true as const };

    const result = await updateSchedule(client, stored.id, input);
    if (!result.ok) return failed(result.reason === 'forbidden' ? 403 : result.reason === 'not-found' ? 404 : 400, 'name', refusalText('edit', result.reason, stored.userId !== null));

    // Whether the edit left it needing approval is the server's answer, never a guess here.
    const approval = await loadAutomationApproval(client, 'SCHEDULE', stored.id);
    return { saved: true as const, needsApproval: approval.state !== 'ADOPTED', approvalPath: approvalHref(app.id, 'SCHEDULE', stored.id) };
  },
};
