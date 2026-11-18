import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadAutomationApprovals } from '$lib/server/automation-approval';
import { loadSchedules } from '$lib/server/automation-schedule';
import type { PageServerLoad } from './$types';

/**
 * portal#1299 — the App's Automations list (automation approval S3). Its own
 * route, like Runs, Tasks and Tickers, so a read the server refuses never
 * reaches the App page's loader.
 *
 * Read-only: the approval itself lives on each automation's page, and a schedule is made and changed on its own
 * (portal#1701). No `actions` export here, and a test pins that. Timing comes from `agentSchedules` (cron, runAt and
 * timezone); the approvals list carries a server-built headline that quotes the cron, which a schedule row does not show.
 */

// automationApprovals' cursor is base64url; anything else cannot have come from it.
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);

  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  // An empty ?after= is the first page; anything else must look like a cursor the server sent.
  const after = url.searchParams.get('after') || null;
  if (after !== null && !CURSOR.test(after)) throw error(400, 'That page of automations does not exist.');

  const [approvals, schedules] = await Promise.all([loadAutomationApprovals(client, app.id, after), loadSchedules(client, app.id)]);
  return { app, approvals, after, schedules };
};
