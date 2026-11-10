import { error, json } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { previewSchedule } from '$lib/server/automation-schedule';
import { previewScheduleInput } from '$lib/automation/schedule-write';
import { parseTimingForm } from '$lib/automation/schedule-form';
import { refusalText } from '$lib/automation/schedule-refusal';
import { t } from '$lib/i18n/t';
import type { RequestHandler } from './$types';

/**
 * portal#1701 — what the schedule being made would do, before Create (hadron-server#3457). The browser posts the same
 * plain choices the Create form does; the answer is one of: `incomplete` (not enough picked yet; nothing asked of the
 * server), `ready` (with the summary), `blocked` (with a plain reason), `refused` (the server's refusal, in plain words).
 * Nothing is stored, and the raw timing line the server returns is never passed on.
 */
export const POST: RequestHandler = async ({ request, params, locals }) => {
  const form = await request.formData();
  const text = (k: string) => String(form.get(k) ?? '').trim();

  const entryNodeUrn = text('entryNodeUrn');
  const zone = text('zone');
  if (!entryNodeUrn || !zone) return json({ state: 'incomplete' as const });
  const timing = parseTimingForm(form, zone);
  if (!timing.ok) return json({ state: 'incomplete' as const });

  const client = gqlClient(locals.token);
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const result = await previewSchedule(client, previewScheduleInput({ appRef: app.id, entryNodeUrn, zone, timing: timing.timing }));
  if (!result.ok) return json({ state: 'refused' as const, message: refusalText('create', result.reason) });
  if (result.outcome === 'ADOPTABLE') return json({ state: 'ready' as const, summary: result.summary });
  return json({
    state: 'blocked' as const,
    message: result.reason === 'MEMORY_UNREADABLE'
      ? t('app.automations.preview.unreadable', 'Something this would read cannot be read by you or by the run, or it is not there. Choose something else, or ask the owner of that memory for access.')
      : t('app.automations.preview.other', 'This cannot be approved from here: it is encrypted, belongs to another organization, or goes beyond what you can consent to. Choose something else.'),
  });
};
