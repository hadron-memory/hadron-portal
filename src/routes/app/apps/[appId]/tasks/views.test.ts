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
        loadedAt: '2026-10-16T01:00:00Z', impersonating: null, board: null, roster: null, alarms: null, titles: {}, ...data },
    },
  } as never).body;
}

describe('sub-navigation', () => {
  it('offers Board · Roster · Alarms and marks the current view', () => {
    const html = page({ view: 'roster', roster: { kind: 'ok', value: { asOf: '2026-10-16T00:00:00Z', workers: [] } } });
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks"[^>]*>Board</);
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?view=roster"[^>]*aria-current="page"[^>]*>Roster</);
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?view=alarms"[^>]*>Alarms</);
  });
});

describe('roster', () => {
  const roster = (workers: unknown[]) => ({ view: 'roster', roster: { kind: 'ok', value: { asOf: '2026-10-16T00:00:00Z', workers } }, titles: { t1: 'Ship it' } });

  it('sorts by attention, names each state, and puts titles on task ids', () => {
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
    expect(html).toContain('href="/app/apps/app-1/tasks/t1"');
    expect(html).toContain('Task 01a13cc6');
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
    ({ view: 'alarms', alarmFilter, alarms: { kind: 'ok', value: { alarms: list, capped } }, titles: { t1: 'Ship it' } });

  it('open by default: acknowledged alarms are hidden; an open one shows the CLI line and no button', () => {
    const html = page(alarms([a('e1'), a('e2', { type: 'assignment.unassignable', acknowledgedAt: '2026-10-15T11:00:00Z', acknowledgedBy: holger })]));
    expect(html).toContain('Not started');
    expect(html).not.toContain('Couldn’t be assigned');
    expect(html).toContain('hadron team alarm ack e1');
    expect(html).toContain('href="/app/apps/app-1/tasks/t1"');
    expect(html).not.toMatch(/<button[^>]*>\s*Acknowledge/);
    expect(html).not.toMatch(/<form/);
  });

  it('the acknowledged filter shows who acknowledged, with no CLI line', () => {
    const html = page(alarms([a('e2', { acknowledgedAt: '2026-10-15T11:00:00Z', acknowledgedBy: holger })], 'acknowledged'));
    expect(html).toContain('Acknowledged by Holger');
    expect(html).not.toContain('hadron team alarm ack');
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
