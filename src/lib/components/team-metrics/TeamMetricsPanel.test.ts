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

  it('a refused window shows an input error beside the form and no figures', () => {
    const h = html({ kind: 'invalid' });
    expect(h).toContain('metrics-invalid');
    expect(h).toContain('metrics-window-form');
    expect(h).not.toContain('metrics-workers');
  });

  it('states what startedOwned counts, and nothing labels flow as owned', () => {
    const h = html(ok());
    expect(h).toContain('name an issue or source');
    const flow = h.slice(h.indexOf('metrics-flow-h'));
    expect(flow.toLowerCase()).not.toContain('owned');
    expect(flow).toContain('whether or not it names an issue');
  });
});
