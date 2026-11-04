import { error, fail, redirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { createSchedule } from '$lib/server/automation-schedule';
import { loadNodeMemories } from '$lib/server/node-memories';
import { createScheduleInput } from '$lib/automation/schedule-write';
import { parseTimingForm } from '$lib/automation/schedule-form';
import { refusalText } from '$lib/automation/schedule-refusal';
import { t } from '$lib/i18n/t';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1701 — make a schedule from the App's Automations page. Creating is approving (Holger, 2026-11-04): the
 * server adopts a new schedule for its creator and it runs at its next time. The portal adds no access gate of its
 * own; the server's refusal (create needs an organization admin) comes back in plain words.
 */

export const load: PageServerLoad = async ({ params, locals }) => {
  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');
  return { app, nodeMemories: loadNodeMemories(client, 'new-schedule') };
};

type Field = 'entry' | 'name' | 'when' | 'hours' | 'time' | 'days' | 'date';
const failed = (status: number, field: Field, message: string) => fail(status, { failure: { field, message } });

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const form = await request.formData();
    const text = (k: string) => String(form.get(k) ?? '').trim();

    // What runs is the picked node's own URN; the schedule takes the node's name unless it has none.
    const entryNodeUrn = text('entryNodeUrn');
    if (!entryNodeUrn) return failed(400, 'entry', t('app.automations.form.err.entry', 'Choose what should run.'));
    const name = text('entryName') || entryNodeUrn;

    // The zone is the browser's, sent explicitly: left out, the server would default to UTC and the schedule would fire at the wrong hour.
    const zone = text('zone');
    if (!zone) return failed(400, 'when', t('app.automations.form.err.zone', 'We could not tell your time zone. Reload the page and try again.'));

    const timing = parseTimingForm(form, zone);
    if (!timing.ok) return failed(400, timing.field, timing.message);

    const client = gqlClient(locals.token);
    const app = await loadTasksApp(client, params.appId);
    if (!app) throw error(404, 'App not found');

    const result = await createSchedule(client, createScheduleInput({ appRef: app.id, name, entryNodeUrn, zone, timing: timing.timing }));
    if (!result.ok) return failed(result.reason === 'forbidden' ? 403 : result.reason === 'not-found' ? 404 : 400, 'name', refusalText('create', result.reason));
    // A schedule is approved by its creator; its page shows when it runs next.
    throw redirect(303, `/app/apps/${encodeURIComponent(app.id)}/automations/schedule/${encodeURIComponent(result.id)}?created=1`);
  },
};
