import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { approveAutomation, declineAutomation, loadAutomationApproval, type AutomationWrite } from '$lib/server/automation-approval';
import { canHoldTeamGrant, giveTeamGrant, loadTeamGrant, stopTeamGrant, type TeamGrantWrite } from '$lib/server/automation-team-grant';
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

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const kind = kindOr404(params.kind);
  const client = gqlClient(locals.token);

  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const approval = await loadAutomationApproval(client, kind, params.ref);
  const showEnded = url.searchParams.get('ended') === '1';
  return { app, kind, ref: params.ref, approval, teamGrant: await loadTeamGrant(client, params.appId, kind, params.ref, showEnded) };
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

export const actions: Actions = {
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
