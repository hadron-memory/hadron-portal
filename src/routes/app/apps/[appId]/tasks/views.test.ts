/**
 * portal#1052 slice 2 — the Roster and Alarms views, rendered on the server,
 * and the sub-navigation that reaches them. Read-only (Holger #11535,
 * variant A): no Acknowledge button, only the CLI line.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

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

function page(data: Record<string, unknown>) {
  return render(Page as never, {
    props: {
      data: { app, view: 'board', filter: 'active', alarmFilter: 'open', boardLimit: 200, alarmsLimit: 2000,
        loadedAt: '2026-10-16T01:00:00Z', impersonating: null, board: null, roster: null, alarms: null, refs: {}, ...data },
    },
  } as never).body.replace(/<!--[\s\S]*?-->/g, ''); // Ignore Svelte snippet anchors; they are not visible link text.
}

describe('portal#1941', () => {
  it('offers an explicit POST acknowledgement to every participant, with the server deciding permission', () => {
    const html = page({ view: 'alarms', alarms: { kind: 'ok', value: { alarms: [{ id: 'e1', type: 'stall.not-started', severity: 'ALARM', taskId: null, createdAt: '2026-11-11T10:00:00Z', subjectWorker: null, acknowledgedAt: null, acknowledgedBy: null, wakes: [] }], capped: false } } });
    expect(html).toMatch(/method="POST"/);
    expect(html).toContain('?/acknowledgeAlarm');
    expect(html).toMatch(/name="eventId"[^>]*value="e1"/);
    expect(html).toContain('Acknowledge');
    expect(html).not.toContain('This view is read-only.');
  });
});

describe('sub-navigation', () => {
  // portal#1090: Roster and Alarms stay read-only; their line says so.
  it('roster and alarms are read-only: no form, no write button, and a line that says so', () => {
    for (const html of [
      page({ view: 'roster', roster: { kind: 'ok', value: { asOf: '2026-10-16T00:00:00Z', workers: [] } } }),
      page({ view: 'alarms', alarms: { kind: 'ok', value: { alarms: [], capped: false } } }),
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

  it('open by default: acknowledged alarms are hidden; an open one shows the CLI line and no button', () => {
    const html = page(alarms([a('e1'), a('e2', { type: 'assignment.unassignable', acknowledgedAt: '2026-10-15T11:00:00Z', acknowledgedBy: holger })]));
    expect(html).toContain('Not started');
    expect(html).not.toContain('Couldn’t be assigned');
    expect(html).toContain('hadron team alarm ack e1');
    expect(html).toContain('href="/app/apps/app-1/tasks/AT3.405"');
    expect(html).not.toMatch(/<button[^>]*>\s*Acknowledge/);
    expect(html).not.toMatch(/<form/);
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
    expect(page(alarms([]))).toContain('No alarms have been raised in this App.');
    expect(page(alarms([a('e2', { acknowledgedAt: '2026-10-15T11:00:00Z' })]))).toContain('No open alarms.');
  });

  it('a capped walk says newer alarms may be missing; a failure is an alert', () => {
    expect(page(alarms([a('e1')], 'open', true))).toContain('Showing the first 2000 alarms');
    expect(page({ view: 'alarms', alarms: { kind: 'failed' } })).toContain('Couldn’t load alarms.');
  });
});
