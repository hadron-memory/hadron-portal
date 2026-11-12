/**
 * portal#1052 slice 2 — the Roster and Alarms views, rendered on the server,
 * and the sub-navigation that reaches them. Read-only (Holger #11535,
 * variant A): no Acknowledge button, only the CLI line.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));

import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const worker = (id: string, name: string) => ({ id, kind: 'WORKER' as const, name, urn: `hrn:worker:acme.com:team:${id}` });
const holger = { id: 'u1', kind: 'USER' as const, name: 'Holger', urn: null };

const entry = (over: Record<string, unknown>) => ({
  worker: worker('w', 'W'), role: 'portal-engineer', state: 'AVAILABLE', family: 'claude', freeFamilies: ['claude'],
  launchableFamilies: [], unavailableFamilies: [], unavailableReason: null, unavailableUntil: null, bound: true,
  liveSession: true, lastActiveAt: null, lastAssignedAt: null, reportsTo: null, reportsToRetired: false,
  startedTasks: [], pendingTasks: [], waitingOn: [], waitingSince: null, unreactedChildTask: null, alarms: [], ...over,
});

function page(data: Record<string, unknown>, form: unknown = null) {
  return render(Page as never, {
    props: {
      form,
      data: { app, view: 'board', filter: 'active', alarmFilter: 'open', boardLimit: 200, alarmsLimit: 2000,
        loadedAt: '2026-10-16T01:00:00Z', impersonating: null, board: null, roster: null, alarms: null, refs: {}, ...data },
    },
  } as never).body.replace(/<!--[\s\S]*?-->/g, ''); // Ignore Svelte snippet anchors; they are not visible link text.
}

describe('portal#1941', () => {
  it.each(['alarmBefore', 'alarmAfter'])('acknowledges within the selected %s page (#1983 QA delta)', key => {
    const cursor = 'a&b=c/d+e%';
    setStubPage(`http://localhost/app/apps/app-1/tasks?view=alarms&alarms=all&${key}=${encodeURIComponent(cursor)}`, { appId: 'app-1' });
    try {
      const html = page({ view: 'alarms', alarmFilter: 'all', alarms: { kind: 'ok', value: { alarms: [{ id: 'e1', type: 'stall.not-started', severity: 'ALARM', taskId: null, createdAt: '2026-11-11T10:00:00Z', subjectWorker: null, acknowledgedAt: null, acknowledgedBy: null, wakes: [] }] } } });
      const form = html.match(/<form\b[^>]*>[\s\S]*?<\/form>/g)?.find(form => /name="eventId"[^>]*value="e1"/.test(form));
      expect(form).toBeDefined();
      const action = form?.match(/action="([^"]+)/)?.[1]?.replaceAll('&amp;', '&');
      expect(action).toBeDefined();
      const target = new URL(action as string, 'http://localhost');
      expect(target.pathname).toBe('/app/apps/app-1/tasks');
      expect(target.searchParams.get('view')).toBe('alarms');
      expect(target.searchParams.get('alarms')).toBe('all');
      expect(target.searchParams.get(key)).toBe(cursor);
      expect(target.searchParams.has(key === 'alarmBefore' ? 'alarmAfter' : 'alarmBefore')).toBe(false);
      expect(target.searchParams.getAll('/acknowledgeAlarm')).toHaveLength(1);
      expect(html).toMatch(/name="eventId"[^>]*value="e1"/);
    } finally { resetStubPage(); }
  });

  it('offers an explicit POST acknowledgement to every participant, with the server deciding permission', () => {
    const html = page({ view: 'alarms', alarms: { kind: 'ok', value: { alarms: [{ id: 'e1', type: 'stall.not-started', severity: 'ALARM', taskId: null, createdAt: '2026-11-11T10:00:00Z', subjectWorker: null, acknowledgedAt: null, acknowledgedBy: null, wakes: [] }], capped: false } } });
    expect(html).toMatch(/method="POST"/);
    const action = html.match(/<form[^>]*action="([^"]+)/)?.[1]?.replaceAll('&amp;', '&');
    const target = new URL(action!, 'http://localhost/app/apps/app-1/tasks?view=alarms');
    expect(target.searchParams.get('view')).toBe('alarms');
    expect([...target.searchParams.keys()]).toContain('/acknowledgeAlarm');
    expect(html).toMatch(/name="eventId"[^>]*value="e1"/);
    expect(html).toContain('Acknowledge');
    expect(html).not.toContain('This view is read-only.');
  });
});

describe('sub-navigation', () => {
  // portal#1090: Roster and Alarms stay read-only; their line says so.
  it('roster stays read-only: no form, no write button, and a line that says so', () => {
    for (const html of [
      page({ view: 'roster', roster: { kind: 'ok', value: { asOf: '2026-10-16T00:00:00Z', workers: [] } } }),
    ]) {
      expect(html).toContain('This view is read-only.');
      expect(html).not.toMatch(/<form/);
      expect(html).not.toMatch(/<button[^>]*>\s*(Create|Assign|Reassign|Cancel|Park|Ready|Make ready|Acknowledge)/i);
      expect(html).not.toContain('New task');
    }
  });

  it('offers Board · Roster · Alarms and marks the current view', () => {
    const html = page({ view: 'roster', roster: { kind: 'ok', value: { asOf: '2026-10-16T00:00:00Z', workers: [] } } });
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks"[^>]*>Board</);
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?view=roster"[^>]*aria-current="page"[^>]*>Roster</);
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?view=alarms"[^>]*>Alarms</);
  });
});

describe('roster', () => {
  const roster = (workers: unknown[]) => ({ view: 'roster', roster: { kind: 'ok', value: { asOf: '2026-10-16T00:00:00Z', workers } }, refs: { t1: { id: 't1', handle: 'AT3.405', title: 'Ship it' } } });

  it('sorts by attention, names each state, puts titles and handles on task ids, and says unavailable for one it cannot resolve', () => {
    const html = page(roster([
      entry({ worker: worker('a', 'Avery'), state: 'AVAILABLE' }),
      entry({ worker: worker('y', 'Yuri'), state: 'YOUR_MOVE', alarms: ['e1', 'e2'], unreactedChildTask: 't1' }),
      entry({ worker: worker('k', 'Kai'), state: 'WORKING', startedTasks: ['t1', '01a13cc6aaaaaaaa'] }),
      entry({ worker: worker('q', 'Quinn'), state: 'NO_FAMILY', bound: true, liveSession: false }),
    ]));
    const order = ['YOUR_MOVE', 'WORKING', 'NO_FAMILY', 'AVAILABLE'].map((s) => html.indexOf(`data-roster-state="${s}"`));
    expect(order).toEqual([...order].sort((x, y) => x - y));
    expect(html).toContain('Your move');
    expect(html).toContain('2 unacknowledged alarm(s)');
    // portal#1349: the link points at the immutable handle, with the handle as a quiet chip.
    expect(html).toContain('href="/app/apps/app-1/tasks/AT3.405"');
    expect(html).toContain('data-task-handle');
    expect(html).toContain('>AT3.405</code>');
    expect(html).toContain('Task unavailable');
    expect(html).not.toContain('01a13cc6');
    expect(html).not.toContain('tasks/01a13cc6aaaaaaaa');
    expect(html).toContain('Quiet');
    expect(html).toContain('Its session reported no model family');
  });

  it('an empty roster says so above a mounted grid; a failure is an alert', () => {
    expect(page(roster([]))).toContain('No workers on this App’s roster.');
    const failed = page({ view: 'roster', roster: { kind: 'failed' } });
    expect(failed).toContain('Couldn’t load the roster.');
    expect(failed).not.toContain('No workers');
  });

  it('a non-participant sees the inline state', () => {
    expect(page({ view: 'roster', roster: { kind: 'not-participant' } })).toContain('You don’t take part in this App’s tasks.');
  });
});

describe('alarms', () => {
  const a = (id: string, over: Record<string, unknown> = {}) => ({
    id, type: 'stall.not-started', severity: 'ALARM', taskId: 't1', createdAt: '2026-10-15T10:00:00Z',
    subjectWorker: worker('k', 'Kai'), acknowledgedAt: null, acknowledgedBy: null,
    wakes: [{ chainIndex: 0, dueAt: '2026-10-15T10:00:00Z', wokenAt: '2026-10-15T10:00:00Z', owner: holger }], ...over,
  });
  const alarms = (list: unknown[], alarmFilter = 'open', capped = false) =>
    ({ view: 'alarms', alarmFilter, alarms: { kind: 'ok', value: { alarms: list, capped } }, refs: { t1: { id: 't1', handle: 'AT3.405', title: 'Ship it' } } });

  it('open by default: acknowledged alarms are hidden; an open one offers acknowledgement and the CLI line', () => {
    const html = page(alarms([a('e1'), a('e2', { type: 'assignment.unassignable', acknowledgedAt: '2026-10-15T11:00:00Z', acknowledgedBy: holger })]));
    expect(html).toContain('Not started');
    expect(html).not.toContain('Couldn’t be assigned');
    expect(html).toContain('hadron team alarm ack e1');
    expect(html).toContain('href="/app/apps/app-1/tasks/AT3.405"');
    expect(html).toMatch(/<button[^>]*>\s*Acknowledge/);
    expect(html).toMatch(/<form/);
  });

  it('does not offer a write while impersonating, and acknowledged rows have no form', () => {
    expect(page({ ...alarms([a('e1')]), impersonating: 'Support view' })).not.toContain('/acknowledgeAlarm');
    expect(page(alarms([a('e1', { acknowledgedAt: '2026-11-11T18:00:00Z' })], 'all'))).not.toContain('/acknowledgeAlarm');
  });
  it('shows the result outside the filtered row, with already-acknowledged informational and unsafe outcomes locked', () => {
    const empty = alarms([]);
    const done = page(empty, { alarmAck: { kind: 'already-acknowledged', eventId: 'e1' } });
    expect(done).toContain('This alarm is already acknowledged; the first acknowledgement stands.');
    expect(done).not.toContain('Not changed.');
    const uncertain = page(alarms([a('e1')]), { alarmAck: { kind: 'uncertain', eventId: 'e1' } });
    expect(uncertain).toContain('may or may not have gone through');
    expect(uncertain).toMatch(/<button[^>]*disabled[^>]*>\s*Acknowledge/);
    expect(uncertain).toContain('Refresh alarms');
    const refused = page(empty, { alarmAck: { kind: 'refused', eventId: 'e1', code: 'ALARM_NOT_IN_CHAIN', message: '<img src=x onerror=alert(1)>' } });
    expect(refused).toContain('ALARM_NOT_IN_CHAIN');
    expect(refused).not.toContain('<img');
  });

  it('the acknowledged filter shows who acknowledged, with no CLI line', () => {
    const html = page(alarms([a('e2', { acknowledgedAt: '2026-10-15T11:00:00Z', acknowledgedBy: holger })], 'acknowledged'));
    expect(html).toContain('Acknowledged by Holger');
    expect(html).not.toContain('hadron team alarm ack');
  });

  // Uma on #1128: a long title in the Task cell drew over Concerns and Woke
  // (an inline truncate never truncates); and Status sits before them so the
  // open state and its ack command are on screen at 1280.
  it('keeps a long task title in its cell, and puts Status before Concerns and Woke', () => {
    const html = page({ ...alarms([a('e1')]), refs: { t1: { id: 't1', handle: 'AT3.405', title: 'T'.repeat(300) } } });
    expect(html).toMatch(/<a href="\/app\/apps\/app-1\/tasks\/AT3\.405" class="min-w-0 truncate/);
    const at = (h: string) => html.indexOf(`>${h}<`);
    expect(at('Status')).toBeGreaterThan(-1);
    expect(at('Status')).toBeLessThan(at('Concerns'));
    expect(at('Status')).toBeLessThan(at('Woke'));
  });

  it('says which kind of empty it is', () => {
    expect(page(alarms([]))).toContain('No alarms on this page.');
    expect(page(alarms([a('e2', { acknowledgedAt: '2026-10-15T11:00:00Z' })]))).toContain('No open alarms on this page.');
  });

  it('1935 removes the obsolete walk-cap notice; a failure is an alert', () => {
    expect(page(alarms([a('e1')], 'open', true))).not.toContain('Showing the first 2000 alarms');
    expect(page({ view: 'alarms', alarms: { kind: 'failed' } })).toContain('Couldn’t load alarms.');
  });
});

// #1935: the server page is not a complete App history, even when filtering yields no rows.
it('1935 keeps older/newer navigation on an empty filtered page and resets cursors on filter changes', () => {
  const html = page({ ...{ view: 'alarms', alarms: { kind: 'ok', value: { alarms: [], nextBefore: 'old' } } },
    alarmPaging: { previousHref: '/app/apps/app-1/tasks?view=alarms&alarmAfter=new', nextHref: '/app/apps/app-1/tasks?view=alarms&alarmBefore=old' } });
  expect(html).toContain('>Newest</a>');
  expect(html).toMatch(/href="[^" ]*alarmBefore=old[^" ]*"[^>]*>Next<\/a>/);
  expect(html).toContain('>Previous</a>');
  expect(html).toContain('No alarms on this page.');
  expect(html).toContain('Search this page');
  expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?view=alarms&amp;alarms=all"/);
});


describe('portal#1987 result and form-target controls', () => {
  const row = { id:'e1', type:'stall.not-started', severity:'ALARM', taskId:null, createdAt:'2026-11-11T10:00:00Z', subjectWorker:null, acknowledgedAt:null, acknowledgedBy:null, wakes:[] };
  it.each(['open','acknowledged','all'])('keeps the %s filter acknowledgement target or correctly hides its form', filter => {
    setStubPage('http://localhost/app/apps/app-1/tasks?view=alarms', {appId:'app-1'});
    try {
      const html = page({view:'alarms',alarmFilter:filter,alarms:{kind:'ok',value:{alarms:[row]}}});
      // Acknowledged hides open rows, so this filter correctly has no write target.
      if (filter === 'acknowledged') { expect(html).not.toContain('&/acknowledgeAlarm'); return; }
      const action = html.match(/<form[^>]*action="([^"]+)/)?.[1]?.replaceAll('&amp;','&');
      expect(action).toBe('/app/apps/app-1/tasks?view=alarms' + (filter === 'open' ? '' : '&alarms='+filter) + '&/acknowledgeAlarm');
    } finally { resetStubPage(); }
  });
  it.each(['failed','not-participant'])('keeps both success and second-ack refusal visible beside a %s read', kind => {
    const data = {view:'alarms',alarms:{kind}};
    const success = page(data,{alarmAck:{kind:'acknowledged',eventId:'e1'}});
    expect(success).toContain('Alarm acknowledged.');
    const second = page(data,{alarmAck:{kind:'already-acknowledged',eventId:'e1'}});
    expect(second).toContain('already acknowledged; the first acknowledgement stands.');
    expect(second).not.toContain('Alarm acknowledged.');
    expect(second).not.toContain('Acknowledged by');
  });
});
