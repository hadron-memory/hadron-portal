import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { loadTasksApp } from '$lib/server/agent-tasks';
import { loadAutomationApprovals } from '$lib/server/automation-approval';
import type { PageServerLoad } from './$types';

/**
 * portal#1299 — the App's Automations list (automation approval S3). Its own
 * route, like Runs, Tasks and Tickers, so a read the server refuses never
 * reaches the App page's loader.
 *
 * Read-only: the approval itself lives on each automation's page. No `actions`
 * export, and a test pins that.
 */

// automationApprovals' cursor is base64url; anything else cannot have come from it.
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);

  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  const after = url.searchParams.get('after');
  if (after !== null && !CURSOR.test(after)) throw error(400, 'Not a page of this list');

  return { app, approvals: await loadAutomationApprovals(client, app.id, after), after };
};
