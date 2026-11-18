/**
 * portal#1299 — the Automations list, rendered on the server. Two states
 * only; the page derives nothing the server did not send; others' text is
 * text; a reader who may not adopt sees nothing that says what is unapproved.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
import List from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const MANUAL = { triggerKind: 'MANUAL', reason: 'approved from the run that needs it' };
const row = (over: Record<string, unknown> = {}) => ({
  triggerKind: 'SCHEDULE', triggerRef: 'sch-1', name: 'Nightly digest', state: 'UNADOPTED',
  headline: 'Nightly digest: Runs on the schedule "0 6 * * *" (UTC); waiting for approval', ...over,
});
const none = { visible: true, schedules: [] };
function list(approvals: unknown, over: Record<string, unknown> = {}) {
  return render(List as never, { props: { data: { app, approvals, after: null, schedules: none, ...over } } } as never).body;
}
const sched = (over: Record<string, unknown> = {}) => ({
  id: 'sch-1', name: 'Nightly digest', entryNodeUrn: 'hrn:node:acme.com:ops:digest', cron: '0 6 * * *', runAt: null, timezone: 'Europe/Berlin', enabled: true,
  nextRunAt: null, lastRunAt: null, userId: 'u1', createdBy: 'u1', ...over,
});
const ok = (rows: unknown[], extra: Record<string, unknown> = {}) => ({ kind: 'ok', rows, nextCursor: null, omitted: [MANUAL], ...extra });

describe('Automations list', () => {
  it('shows exactly two states: waiting for approval and approved', () => {
    const html = list(ok([row(), row({ triggerRef: 'wh-1', triggerKind: 'WEBHOOK', name: 'Inbound', state: 'ADOPTED', headline: 'Inbound: Starts when called; approved' })]));
    expect(html).toContain('Waiting for approval');
    expect(html).toContain('Approved');
    expect(html).not.toMatch(/up to date/i);
    expect(html).not.toMatch(/changed/i);
  });

  it('never calls an approved row up to date, even when the server’s headline is all it has', () => {
    expect(list(ok([row({ state: 'ADOPTED', headline: 'Nightly digest: Runs daily; approved' })]))).not.toMatch(/up to date/i);
  });

  it('links each row to its approval page by kind and trigger id', () => {
    const html = list(ok([row(), row({ triggerKind: 'WEBHOOK', triggerRef: 'wh-1', name: 'Inbound', state: 'ADOPTED' })]));
    expect(html).toContain('href="/app/apps/app-1/automations/schedule/sch-1"');
    expect(html).toContain('href="/app/apps/app-1/automations/webhook/wh-1"');
  });

  it('says where manual runs are approved, from the server’s omission', () => {
    expect(list(ok([row()]))).toContain('Manual runs are approved from the run that needs them');
  });

  it('renders others’ text as text: a name and a headline carrying markup stay inert', () => {
    const html = list(ok([row({ triggerKind: 'WEBHOOK', name: '<img src=x onerror=alert(1)>', headline: '<b>bold</b> **md** [x](javascript:alert(1))' })]));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).not.toMatch(/<a[^>]*href="javascript:/);
    expect(html).toContain('&lt;img src=x onerror=alert(1)>');
    expect(html).toContain('**md**');
  });

  it('a reader with nothing to review sees no state, no count and no table', () => {
    const html = list(ok([]));
    expect(html).not.toMatch(/Waiting for approval|Approved/);
    expect(html).not.toMatch(/\d+ (automations?|waiting|to approve)/i);
    expect(html).not.toContain('<table');
    expect(html).toContain('Nothing to review here.');
  });

  it('pages by the server’s cursor: Next appears only when one came back, however short the page', () => {
    expect(list(ok([row()], { nextCursor: 'c1' }))).toContain('href="/app/apps/app-1/automations?after=c1"');
    expect(list(ok([row()], { nextCursor: null }))).not.toContain('?after=');
  });

  it('offers the first page again from a later page', () => {
    expect(list(ok([row()]), { after: 'c1' })).toContain('href="/app/apps/app-1/automations"');
  });

  // portal#1701 — a schedule's timing in plain words, wherever schedules are listed (acceptance 1, 4, 5).
  describe('schedule timing', () => {
    it('says when a schedule runs in a sentence, in its own zone, and never shows its cron', () => {
      const html = list(ok([row()]), { schedules: { visible: true, schedules: [sched()] } });
      expect(html).toContain('Every day at 06:00 (Europe/Berlin)');
      expect(html).not.toContain('0 6 * * *');
    });

    it('shows a cron the plain controls cannot express as it is, never rewritten', () => {
      const html = list(ok([row()]), { schedules: { visible: true, schedules: [sched({ cron: '*/5 9-17 * * 1-5' })] } });
      expect(html).toContain('On a custom schedule: */5 9-17 * * 1-5 (Europe/Berlin)');
    });

    it('says a paused schedule is paused', () => {
      expect(list(ok([row()]), { schedules: { visible: true, schedules: [sched({ enabled: false })] } })).toContain('Paused');
      expect(list(ok([row()]), { schedules: { visible: true, schedules: [sched()] } })).not.toContain('Paused');
    });

    it('a schedule row with no matching schedule renders without timing, and without the server headline that quotes the cron', () => {
      const html = list(ok([row()]), { schedules: none });
      expect(html).toContain('Nightly digest');
      expect(html).not.toContain('0 6 * * *');
      expect(html).not.toContain('Runs on the schedule');
    });

    it('a webhook row keeps the server\'s own sentence', () => {
      expect(list(ok([row({ triggerKind: 'WEBHOOK', triggerRef: 'wh-1', headline: 'Inbound: Starts when called; approved' })]))).toContain('Inbound: Starts when called; approved');
    });

    it('offers a new schedule, to everyone: the server decides who may', () => {
      expect(list(ok([row()]))).toContain('href="/app/apps/app-1/automations/new-schedule"');
      expect(list(ok([]))).toContain('href="/app/apps/app-1/automations/new-schedule"');
    });
  });
});
