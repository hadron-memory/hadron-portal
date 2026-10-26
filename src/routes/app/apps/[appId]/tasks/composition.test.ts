/**
 * portal#1316 — the Composition view of the App's Tasks page, rendered on the
 * server. Direct-report lanes and the server's own headcounts: nothing here is
 * joined, recounted or re-sorted by the page.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));

import Page from './+page.svelte';
import { parseTaskView } from '$lib/agent-tasks/views';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const party = (id: string, name: string) => ({ id, kind: 'WORKER' as const, name, urn: `hrn:worker:acme.com:team:${id}` });
const member = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  worker: party(id, name), role: 'engineer', family: 'claude', bound: true, liveSession: true, state: 'AVAILABLE', ...over,
});
const lane = (over: Record<string, unknown>) => ({
  coordinator: null, coordinatorRetired: false, workers: [], countsByRole: [], countsByRoleFamily: [], ...over,
});

function page(composition: unknown, data: Record<string, unknown> = {}) {
  return render(Page as never, {
    props: {
      data: { app, view: 'composition', filter: 'active', alarmFilter: 'open', boardLimit: 200, alarmsLimit: 2000,
        loadedAt: '2026-10-26T01:00:00Z', impersonating: null, board: null, roster: null, alarms: null, titles: {},
        composition, ...data },
    },
  } as never).body;
}
const ok = (lanes: unknown[]) => ({ kind: 'ok', value: { appId: 'app-1', asOf: '2026-10-26T00:00:00Z', lanes } });

describe('the view is addressable', () => {
  it('?view=composition parses, and an unknown view still falls back to the board', () => {
    expect(parseTaskView('composition')).toBe('composition');
    expect(parseTaskView('nope')).toBe('board');
  });

  it('is offered beside Roster, marked current, and stays read-only', () => {
    const html = page(ok([]));
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?view=composition"[^>]*aria-current="page"[^>]*>Composition</);
    expect(html).toMatch(/href="\/app\/apps\/app-1\/tasks\?view=roster"[^>]*>Roster</);
    expect(html).toContain('This view is read-only.');
    expect(html).not.toMatch(/<form/);
  });
});

describe('lanes', () => {
  const lanes = [
    lane({
      coordinator: party('z', 'Zed'),
      workers: [member('w2', 'Wren', { role: null, family: null, bound: false, liveSession: false, state: 'NOT_LAUNCHABLE' })],
      countsByRole: [{ role: null, count: 1 }],
      countsByRoleFamily: [{ role: null, family: null, count: 1 }],
    }),
    lane({
      coordinator: party('c', 'Cleo'), coordinatorRetired: true,
      workers: [member('w1', 'Avery', { bound: true, liveSession: false })],
      countsByRole: [{ role: 'engineer', count: 1 }],
      countsByRoleFamily: [{ role: 'engineer', family: 'claude', count: 1 }],
    }),
    lane({ coordinator: null, workers: [member('w3', 'Orla')], countsByRole: [{ role: 'engineer', count: 1 }], countsByRoleFamily: [{ role: 'engineer', family: 'claude', count: 1 }] }),
  ];

  it('keeps the server order: lanes as returned (not alphabetical), workers in lane order', () => {
    const html = page(ok(lanes));
    const at = (s: string) => html.indexOf(s);
    expect(at('Zed')).toBeGreaterThan(-1);
    expect(at('Zed')).toBeLessThan(at('Cleo'));
    expect(at('Wren')).toBeLessThan(at('Avery'));
    expect(at('Avery')).toBeLessThan(at('Orla'));
  });

  it('names each coordinator with a canonical URN, flags a retired one, and shows null as Unassigned', () => {
    const html = page(ok(lanes));
    expect(html).toContain('hrn:worker:acme.com:team:z');
    expect(html).toContain('hrn:worker:acme.com:team:c');
    expect(html).toContain('hrn:worker:acme.com:team:w1');
    expect(html).toContain('(retired)');
    expect(html.match(/\(retired\)/g)).toHaveLength(1);
    expect(html).toContain('Unassigned');
    expect(html).not.toMatch(/hrn:worker:acme.com:team:null|hrn:worker:acme.com:team:undefined/);
  });

  it('shows null role and null family as their own buckets, not a guessed default', () => {
    const html = page(ok(lanes));
    expect(html).toContain('No role');
    expect(html).toContain('No family');
    expect(html).not.toMatch(/>\s*(null|undefined|unknown|other)\s*</i);
  });

  it('shows bound and live session as two separate facts, with no availability word of its own', () => {
    const html = page(ok(lanes));
    expect(html).toMatch(/data-worker="w1"[^>]*data-bound="true"[^>]*data-live-session="false"/);
    expect(html).toMatch(/data-worker="w2"[^>]*data-bound="false"[^>]*data-live-session="false"/);
    expect(html).toMatch(/data-worker="w3"[^>]*data-bound="true"[^>]*data-live-session="true"/);
    expect(html).toContain('Bound');
    expect(html).toContain('Live session');
  });

  // The server's counts are the answer; a page that re-derived them from the
  // workers it holds would print 1 here.
  it('prints the server headcounts, never a recount of the workers it holds', () => {
    const html = page(ok([lane({
      coordinator: party('c', 'Cleo'),
      workers: [member('w1', 'Avery')],
      countsByRole: [{ role: 'engineer', count: 7 }],
      countsByRoleFamily: [{ role: 'engineer', family: 'claude', count: 5 }],
    })]));
    expect(html).toMatch(/data-count-role="engineer"[^>]*>[^<]*7</);
    expect(html).toMatch(/data-count-role-family="engineer\/claude"[^>]*>[^<]*5</);
  });

  it('says when the data was read', () => {
    expect(page(ok(lanes))).toContain('As of');
  });
});

describe('the three ways a read can not be a list', () => {
  it('a known empty team says so, and is not an error', () => {
    const html = page(ok([]));
    expect(html).toContain('No workers on this App’s roster.');
    expect(html).not.toContain('Couldn’t load');
    expect(html).not.toContain('You don’t take part');
  });

  it('a failed read is an alert with a retry, and never reads as an empty team', () => {
    const html = page({ kind: 'failed' });
    expect(html).toContain('Couldn’t load the composition.');
    expect(html).toContain('Try again');
    expect(html).not.toContain('No workers on this App’s roster.');
  });

  it('a withheld read is the inline non-participant state, and never reads as an empty team', () => {
    const html = page({ kind: 'not-participant' });
    expect(html).toContain('You don’t take part in this App’s tasks.');
    expect(html).not.toContain('No workers on this App’s roster.');
    expect(html).not.toContain('Couldn’t load');
  });
});
