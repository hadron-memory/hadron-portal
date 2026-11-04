import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { approveAutomation, declineAutomation, loadAutomationApproval, type AutomationWrite } from '$lib/server/automation-approval';
import { canHoldTeamGrant, giveTeamGrant, loadTeamGrant, stopTeamGrant, type TeamGrantWrite } from '$lib/server/automation-team-grant';
import { loadSchedules, setScheduleEnabled } from '$lib/server/automation-schedule';
import { refusalText } from '$lib/automation/schedule-refusal';
import { kindFromRoute } from '$lib/automation/approval';
import type { Actions, PageServerLoad } from './$types';

/**
 * portal#1299 — one automation's approval page (automation approval S3). The
 * server computes the state, the hash and every sentence; the portal shows
 * them. A reader the server refuses gets the same 404 as a trigger that does
 * not exist, so the page cannot be used to learn which automations exist.
 */

function kindOr404(segment: string) {
  const kind = kindFromRoute(segment);
  if (!kind) throw error(404, 'Automation not found');
  return kind;
}

async function readSchedule(client: ReturnType<typeof gqlClient>, appId: string, id: string) {
  try {
    return (await loadSchedules(client, appId)).schedules.find((s) => s.id === id) ?? null;
  } catch {
    return null;
  }
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const kind = kindOr404(params.kind);
  const client = gqlClient(locals.token);

  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const approval = await loadAutomationApproval(client, kind, params.ref);
  const showEnded = url.searchParams.get('ended') === '1';
  // portal#1701: only a schedule has timing to read. A reader the server refuses (or a schedule not in the list) gets
  // null and the page falls back to the server's own summary line.
  // A failed read of the timing is not a failed page: the approval below is the page's real job, and the server's own
  // summary line is the fallback.
  const schedule = kind === 'SCHEDULE' ? await readSchedule(client, app.id, params.ref) : null;
  const created = kind === 'SCHEDULE' && url.searchParams.get('created') === '1';
  return { app, kind, ref: params.ref, approval, schedule, created, teamGrant: await loadTeamGrant(client, params.appId, kind, params.ref, showEnded) };
};

// The trigger comes from the URL, never from the form: a posted body cannot redirect an approval.
function outcome(result: AutomationWrite, done: Record<string, true>) {
  if (result.ok) return done;
  if (result.reason === 'stale') return fail(409, { code: 'stale' as const });
  return fail(403, { code: 'refused' as const, message: result.message });
}

// portal#1650: as above, the trigger comes from the URL. A manual run can never hold the grant.
function teamGrantKindOr404(segment: string) {
  const kind = kindOr404(segment);
  if (!canHoldTeamGrant(kind)) throw error(404, 'Automation not found');
  return kind;
}
function teamGrantOutcome(result: TeamGrantWrite, done: 'given' | 'stopped') {
  if (result.ok) return { teamGrant: done };
  return fail(403, { teamGrantRefused: true as const, teamGrantMessage: result.message });
}

// portal#1701: the schedule id comes from the URL, never the form. Pause is exactly {enabled:false}.
function scheduleKindOr404(segment: string) {
  if (kindOr404(segment) !== 'SCHEDULE') throw error(404, 'Automation not found');
}
async function setEnabled(params: { appId: string; kind: string; ref: string }, token: string | null, enabled: boolean) {
  scheduleKindOr404(params.kind);
  const r = await setScheduleEnabled(gqlClient(token), params.ref, enabled);
  if (r.ok) return { scheduleEnabled: enabled };
  return fail(403, { scheduleRefused: true as const, scheduleMessage: refusalText(enabled ? 'resume' : 'pause', r.reason) });
}

export const actions: Actions = {
  pause: ({ params, locals }) => setEnabled(params, locals.token, false),
  resume: ({ params, locals }) => setEnabled(params, locals.token, true),

  // Approve binds the hash the page showed. A stale hash is reported once and
  // never retried: the person reads the new summary and approves again.
  approve: async ({ request, params, locals }) => {
    const kind = kindOr404(params.kind);
    const expectedHash = String((await request.formData()).get('expectedHash') ?? '').trim();
    if (!expectedHash) return fail(400, { code: 'missing-hash' as const });
    return outcome(await approveAutomation(gqlClient(locals.token), kind, params.ref, expectedHash), { approved: true });
  },

  // Decline names the trigger only.
  decline: async ({ params, locals }) => {
    const kind = kindOr404(params.kind);
    return outcome(await declineAutomation(gqlClient(locals.token), kind, params.ref), { declined: true });
  },

  give: async ({ params, locals }) => {
    const kind = teamGrantKindOr404(params.kind);
    return teamGrantOutcome(await giveTeamGrant(gqlClient(locals.token), params.appId, kind, params.ref), 'given');
  },

  stop: async ({ params, locals }) => {
    const kind = teamGrantKindOr404(params.kind);
    return teamGrantOutcome(await stopTeamGrant(gqlClient(locals.token), params.appId, kind, params.ref), 'stopped');
  },
};
