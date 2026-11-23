import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import TeamMetricsPanel from './TeamMetricsPanel.svelte';
import type { MetricsCount, TeamMetrics, TeamMetricsView } from '$lib/team-metrics/types';

const count = (total: number, o: Partial<MetricsCount> = {}): MetricsCount => ({ total, ids: Array.from({ length: Math.min(total, 3) }, (_, i) => `id${i}abcdefgh`), truncated: false, ...o });
const base: TeamMetrics = {
  appId: 'app1', asOf: '2026-11-22T10:00:00Z', window: { since: '2026-11-15T00:00:00Z', until: '2026-11-22T00:00:00Z' },
  startedOwned: {
    all: count(5), ownersTruncated: false,
    byOwner: [{
      owner: { id: 'w1', kind: 'WORKER', name: 'Gil', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:gil' },
      tasks: count(5), projectsTruncated: false,
      byProject: [
        { project: { handle: 'AT0.1', noProject: false, taskId: 't1', title: 'Metrics' }, tasks: count(3) },
        { project: { handle: 'AT0', noProject: true, taskId: null, title: null }, tasks: count(2) },
      ],
    }],
  },
  projects: { truncated: false, items: [{ project: { handle: 'AT0.1', noProject: false, taskId: 't1', title: 'Metrics' }, children: [{ status: 'STARTED', tasks: count(3) }] }] },
  workers: { active: count(2), idle: count(1), overdue: count(0), inop: count(1) },
  flow: { completed: count(4), started: count(6) },
};
const html = (view: TeamMetricsView) => render(TeamMetricsPanel, { props: { view, appId: 'app1' } }).body;
const ok = (m: Partial<TeamMetrics> = {}): TeamMetricsView => ({ kind: 'ok', metrics: { ...base, ...m } });

describe('TeamMetricsPanel states', () => {
  it('a full answer shows the four worker counts, the owner row and the flow window', () => {
    const h = html(ok());
    for (const l of ['Active', 'Idle', 'Overdue', 'Not operating']) expect(h).toContain(l);
    expect(h).toContain('Gil');
    expect(h).toContain('hrn:worker:hadronmemory.com:hadron-dev-team:gil');
    expect(h).toContain('metrics-window');
    expect(h).toContain('not including');
  });

  it('a roster-only reader: three null panels say not visible, never zero, and workers still render', () => {
    const h = html(ok({ startedOwned: null, projects: null, flow: null }));
    for (const id of ['metrics-started-null', 'metrics-projects-null', 'metrics-flow-null']) expect(h).toContain(id);
    expect(h.match(/Not visible to you/g)?.length).toBe(3);
    expect(h).not.toContain('metrics-started-empty');
    expect(h).not.toContain('metrics-projects-empty');
    expect(h).toContain('metrics-workers');
    expect(h).toContain('Active');
  });

  it('empty lists are their own state, not the not-visible one', () => {
    const h = html(ok({ startedOwned: { all: count(0), ownersTruncated: false, byOwner: [] }, projects: { truncated: false, items: [] } }));
    expect(h).toContain('metrics-started-empty');
    expect(h).toContain('metrics-projects-empty');
    expect(h).not.toContain('Not visible to you');
  });

  it('a truncated count says first N of total, with the total from total and not the id count', () => {
    const h = html(ok({ workers: { ...base.workers, active: count(450, { ids: Array.from({ length: 200 }, (_, i) => `w${i}`), truncated: true }) } }));
    expect(h).toContain('metrics-truncated');
    expect(h).toContain('First 200 of 450');
    expect(h).toContain('>450<');
  });

  it('owner, owner-project and project truncation each show', () => {
    const so = { ...base.startedOwned!, ownersTruncated: true, byOwner: [{ ...base.startedOwned!.byOwner[0]!, projectsTruncated: true }] };
    const h = html(ok({ startedOwned: so, projects: { ...base.projects!, truncated: true } }));
    for (const id of ['metrics-owners-truncated', 'metrics-owner-projects-truncated', 'metrics-projects-truncated']) expect(h).toContain(id);
  });

  it('a null project handle is the No project bucket, not blank', () => {
    expect(html(ok())).toContain('metrics-no-project');
  });

  it('APP_NOT_FOUND is the refusal, not an empty dashboard', () => {
    const h = html({ kind: 'hidden' });
    expect(h).toContain('metrics-hidden');
    expect(h).not.toContain('metrics-workers');
    expect(h).not.toContain('metrics-window-form');
  });

  it('an outage is an error, not a refusal or zeros', () => {
    const h = html({ kind: 'failed' });
    expect(h).toContain('metrics-failed');
    expect(h).not.toContain('metrics-hidden');
  });

  it('a refused window shows an input error beside the form and keeps Workers and the snapshot', () => {
    const h = html({ kind: 'invalid', metrics: base });
    expect(h).toContain('metrics-invalid');
    expect(h).toContain('metrics-window-form');
    expect(h).toContain('metrics-workers');
  });

  it('a refused window with nothing to show is the input error alone', () => {
    const h = html({ kind: 'invalid', metrics: null });
    expect(h).toContain('metrics-invalid');
    expect(h).not.toContain('metrics-workers');
  });

  it('an owner shows once: one row, its URN and total once, however many projects', () => {
    const h = html(ok());
    expect(h.match(/metrics-owner-row/g)?.length).toBe(1);
    expect(h.match(/hrn:worker:hadronmemory\.com:hadron-dev-team:gil/g)?.length).toBe(1);
  });

  it('times are UTC with a fixed locale, so the server and the browser agree', () => {
    const h = html(ok());
    expect(h).toContain('Nov 22, 2026, 10:00 AM UTC');
    expect(h).toContain('Nov 15, 2026, 12:00 AM UTC');
  });

  it('states what startedOwned counts, and nothing labels flow as owned', () => {
    const h = html(ok());
    expect(h).toContain('name an issue or source');
    const flow = h.slice(h.indexOf('metrics-flow-h'));
    expect(flow.toLowerCase()).not.toContain('owned');
    expect(flow).toContain('whether or not it names an issue');
  });

  it('on a phone the by-project breakdown folds into the owner cell, and the column is hidden below sm (#2535)', () => {
    const h = html(ok());
    expect(h).toContain('metrics-owner-projects-phone');
    expect(h).toContain('metrics-project-children-phone');
    // the wide columns carry max-sm:hidden, the folded copies carry sm:hidden
    expect(h).toMatch(/<th[^>]*max-sm:hidden[^>]*>[\s\S]*?By project/);
    expect(h).toMatch(/<th[^>]*max-sm:hidden[^>]*>[\s\S]*?Direct tasks by status/);
  });

  it('the By project column is not sortable: it sorted by a concatenated string (#2535)', () => {
    const h = html(ok());
    const th = h.match(/<th[^>]*>(?:(?!<\/th>)[\s\S])*By project/)?.[0] ?? '';
    expect(th).not.toContain('cursor-pointer');
  });

  it('a status shows as a word, not the stored STARTED/PENDING key (#2535)', () => {
    const h = html(ok({ projects: { truncated: false, items: [{ project: base.projects!.items[0]!.project, children: [{ status: 'STARTED', tasks: count(3) }, { status: 'PENDING', tasks: count(1) }] }] } }));
    expect(h).toContain('>Started<');
    expect(h).toContain('>Pending<');
    expect(h).not.toContain('>STARTED<');
  });

  it('times stay UTC under a non-UTC TZ: the suite runs in UTC, so a dropped timeZone would pass (#2535)', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'Pacific/Kiritimati';
    try {
      const h = html(ok());
      expect(h).toContain('Nov 22, 2026, 10:00 AM UTC');
      expect(h).toContain('Nov 15, 2026, 12:00 AM UTC');
    } finally {
      if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev;
    }
  });
});
