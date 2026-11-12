import { error, redirect, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { BOARD_LIMIT, loadAlarms, loadBoard, hydrateTaskRefs, loadComposition, loadRoster, loadTasksApp } from '$lib/server/agent-tasks';
import { parseBoardFilter } from '$lib/agent-tasks/status';
import { parseNarrow, parseTags } from '$lib/agent-tasks/narrow';
import { parseAlarmFilter, rosterTaskIds } from '$lib/agent-tasks/roster';
import type { TaskRefs } from '$lib/agent-tasks/types';
import { parseTaskView } from '$lib/agent-tasks/views';
import { ACKNOWLEDGE_ALARM_MUTATION } from '$lib/server/queries';
import { classifyWriteError, impersonationRefusal, taskWrite } from '$lib/server/agent-task-writes';
import type { WriteRefusal } from '$lib/agent-tasks/actions';
import type { AlarmAckResult } from '$lib/agent-tasks/alarm-ack';
import { withTimeout } from '$lib/server/with-timeout';
import { signinRedirectFor } from '$lib/server/session-action-guard';
import type { Actions, PageServerLoad } from './$types';


/**
 * portal#1052 — the App's Tasks sub-route: Board · Roster · Composition · Alarms
 * (initially read-only, Holger #10660; alarm acknowledgement adds portal#1941). A sub-route of its own, like Runs and Channels, so a task
 * read that refuses a non-participant (APP_NOT_FOUND) can never reach the App
 * page's loader, and the board, a filter and a task are each linkable
 * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-views §2).
 *
 * Only the view on screen is read.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const client = gqlClient(locals.token);
  const view = parseTaskView(url.searchParams.get('view'));
  const text = (url.searchParams.get('text') ?? '').trim();
  const filter = parseBoardFilter(url.searchParams.get('status'));
  const { narrow, overdueDropped } = parseNarrow(url.searchParams, filter);
  const alarmFilter = parseAlarmFilter(url.searchParams.get('alarms'));

  // The App's header comes first and alone: a missing App is a 404 whatever
  // the task read would have said.
  const app = await loadTasksApp(client, params.appId);
  if (!app) throw error(404, 'App not found');

  // Canonicalize crafted blank GETs too (including with JavaScript disabled).
  // Same for a blank tag list, and for an overdue value that is not the one
  // the form sends (a dropped Overdue keeps its 1 so the page can say so).
  const blankText = url.searchParams.has('text') && !text;
  const blankTags = url.searchParams.has('tags') && parseTags(url.searchParams.get('tags')).length === 0;
  const strayOverdue = url.searchParams.has('overdue') && url.searchParams.get('overdue') !== '1';
  if (view === 'board' && (blankText || blankTags || strayOverdue)) {
    const canonical = new URL(url);
    if (blankText) canonical.searchParams.delete('text');
    if (blankTags) canonical.searchParams.delete('tags');
    if (strayOverdue) canonical.searchParams.delete('overdue');
    throw redirect(303, canonical.pathname + canonical.search);
  }

  const base = {
    app,
    view,
    filter,
    alarmFilter,
    text,
    overdue: narrow.overdue,
    tags: narrow.tags,
    overdueDropped,
    boardLimit: BOARD_LIMIT,
    alarmPaging: null as { previousHref: string | null; nextHref: string | null } | null,
    loadedAt: new Date().toISOString(),
    // §8: a non-participant who is impersonating is told whose view it is.
    impersonating: locals.impersonation ? (locals.user?.name ?? locals.user?.email ?? locals.user?.id ?? null) : null,
  };

  if (view === 'roster') {
    const roster = await loadRoster(client, app.id);
    // Only the references the loaded roster carries, each through the readable-task gate.
    const refs = await hydrateTaskRefs(client, app.id, roster.kind === 'ok' ? rosterTaskIds(roster.value) : []);
    return { ...base, board: null, roster, composition: null, alarms: null, refs };
  }
  if (view === 'composition') {
    return { ...base, board: null, roster: null, composition: await loadComposition(client, app.id), alarms: null, refs: {} as TaskRefs };
  }
  if (view === 'alarms') {
    const before = url.searchParams.get('alarmBefore') || undefined;
    const after = url.searchParams.get('alarmAfter') || undefined;
    if (before && after) throw error(400, 'Choose one alarm page direction');
    const alarms = await loadAlarms(client, app.id, before, after, alarmFilter === 'in-effect');
    const href = (key: 'alarmBefore' | 'alarmAfter', cursor: string) => {
      const target = new URL(url);
      target.searchParams.delete('alarmBefore');
      target.searchParams.delete('alarmAfter');
      target.searchParams.set(key, cursor);
      return target.pathname + target.search;
    };
    const alarmPaging = {
      previousHref: alarms.kind === 'ok' && alarms.value.previousAfter
        ? href('alarmAfter', alarms.value.previousAfter) : null,
      nextHref: alarms.kind === 'ok' && alarms.value.nextBefore
        ? href('alarmBefore', alarms.value.nextBefore) : null,
    };
    const refs = await hydrateTaskRefs(client, app.id, alarms.kind === 'ok' ? alarms.value.alarms.map((a) => a.taskId) : []);
    return { ...base, board: null, roster: null, composition: null, alarms, refs, alarmPaging };
  }
  const board = await loadBoard(client, app.id, filter, text, narrow);
  return { ...base, board, roster: null, composition: null, alarms: null, refs: {} as TaskRefs };
};


// Unlike task writes, these alarm-only refusals have their own allowlist.
function classifyAlarmError(e: unknown): WriteRefusal {
  const first = (e as { response?: { errors?: { message?: unknown; extensions?: { code?: unknown } }[] } } | null)?.response?.errors?.[0];
  const code = first?.extensions?.code;
  if (typeof code === 'string' && ['ALARM_NOT_FOUND', 'NOT_AN_ALARM', 'ALARM_NOT_IN_CHAIN', 'ALARM_ALREADY_ACKNOWLEDGED'].includes(code) && typeof first?.message === 'string') {
    return { kind: 'refused', code, message: first.message };
  }
  return classifyWriteError(e);
}

export const actions = {
  acknowledgeAlarm: async ({ request, locals, url }) => {
    // Actions run before layout loads; the layout sign-in redirect is not a guard.
    if (!locals.token) throw redirect(303, signinRedirectFor(url));
    const fd = await request.formData();
    const value = fd.get('eventId');
    const suppliedId = typeof value === 'string' ? value.trim() : '';
    // Keep the refusal result bounded even when impersonation refuses before
    // input validation. Validate the full supplied value, never a truncated id.
    const eventId = suppliedId.slice(0, 200);
    const result = (kind: AlarmAckResult['kind'], extra: Partial<AlarmAckResult> = {}) => ({ alarmAck: { eventId, kind, ...extra } satisfies AlarmAckResult });
    if (locals.impersonation) {
      const refusal = impersonationRefusal();
      return fail(403, result('refused', refusal.kind === 'refused' ? { code: refusal.code, message: refusal.message } : {}));
    }
    if (!suppliedId || suppliedId.length > 200) return fail(400, result('refused', { code: 'BAD_USER_INPUT' }));
    // A deadline cannot establish whether a write committed. Never retry it here.
    const out = await withTimeout(taskWrite<{ acknowledgeAlarm: { id: string; acknowledgedAt: string } }>(
      gqlClient(locals.token), ACKNOWLEDGE_ALARM_MUTATION, { eventId }, 'acknowledgeAlarm', classifyAlarmError,
    ), 15000, null);
    if (!out) return fail(502, result('uncertain'));
    if (out.kind === 'committed-error') return result('acknowledged', { warnings: out.warnings, more: out.more });
    if (out.kind === 'ok') {
      const alarm = out.data?.acknowledgeAlarm;
      if (alarm?.id === eventId && typeof alarm.acknowledgedAt === 'string' && Number.isFinite(Date.parse(alarm.acknowledgedAt))) {
        return result('acknowledged', { warnings: out.warnings, more: out.more });
      }
      return fail(502, result('uncertain'));
    }
    const refusal = out.refusal;
    if (refusal.kind === 'refused') {
      if (refusal.code === 'ALARM_ALREADY_ACKNOWLEDGED') return result('already-acknowledged');
      return fail(refusal.code === 'ALARM_NOT_IN_CHAIN' || refusal.code === 'FORBIDDEN' ? 403 : refusal.code === 'ALARM_NOT_FOUND' || refusal.code === 'APP_NOT_FOUND' ? 404 : 400,
        result('refused', { code: refusal.code, message: refusal.message }));
    }
    return fail(502, result('uncertain'));
  },
} satisfies Actions;
