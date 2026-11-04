/** portal#1701 — the schedule section of the approval page, rendered on the server. */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }), applyAction: vi.fn(), deserialize: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const CRON_LINE = 'Runs on the schedule "0 9 * * *" (UTC).';
const summary = { name: 'Digest', schedule: CRON_LINE, reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] };
const sched = (over: Record<string, unknown> = {}) => ({ id: 'sch-1', name: 'Digest', entryNodeUrn: 'hrn:node:acme.com:m:e', cron: '0 9 * * *', runAt: null, timezone: 'Europe/Berlin', enabled: true, nextRunAt: '2026-11-05T08:00:00.000Z', lastRunAt: null, userId: 'u1', createdBy: 'u1', ...over });
function page(over: Record<string, unknown> = {}, form: unknown = null) {
  return render(Page as never, { props: { data: { app, kind: 'SCHEDULE', ref: 'sch-1', approval: { state: 'UNADOPTED', hash: 'h', depth: {}, summary }, teamGrant: { status: 'hidden' }, schedule: sched(), created: false, ...over }, form } } as never).body;
}

describe('schedule section', () => {
  it('says when it runs in a sentence and never shows the cron', () => {
    const html = page();
    expect(html).toContain('Every day at 09:00 (Europe/Berlin)');
    expect(html).not.toContain('0 9 * * *');
    expect(html).toContain('Next run:');
    expect(html).toMatch(/>\s*Pause\s*</);
    expect(html).toContain('action="?/pause"');
    expect(html).toContain('/automations/schedule/sch-1/edit');
  });
  it('a paused schedule is marked, offers Resume, and shows no next run', () => {
    const html = page({ schedule: sched({ enabled: false }) });
    expect(html).toContain('Paused');
    expect(html).toMatch(/>\s*Resume\s*</);
    expect(html).toContain('action="?/resume"');
    expect(html).not.toContain('Next run:');
  });
  it('falls back to the server line when the schedule could not be read', () => {
    const html = page({ schedule: null });
    expect(html).toContain('Runs on the schedule');
    expect(html).not.toContain('action="?/pause"');
  });
  it('a custom cron is kept verbatim, as a custom schedule', () => {
    expect(page({ schedule: sched({ cron: '*/5 * * * *' }) })).toContain('On a custom schedule: *&#47;5 * * * * (Europe/Berlin)'.replace('&#47;', '/'));
  });
  it('says it was created and approved only after ?created=1', () => {
    expect(page({ created: true })).toContain('You approved it by creating it');
    expect(page()).not.toContain('You approved it by creating it');
  });
  it('a refused pause says so in plain words', () => {
    expect(page({}, { scheduleRefused: true, scheduleMessage: 'Only an organization admin can pause a schedule.' })).toContain('Only an organization admin can pause');
  });
  it('a webhook shows no schedule controls', () => {
    const html = page({ kind: 'WEBHOOK', schedule: null });
    expect(html).not.toContain('action="?/pause"');
    expect(html).not.toContain('/edit');
  });
  it('LOCAL P2-5: an ADOPTED schedule offers Pause, not Decline; an unapproved or changed one keeps Decline', () => {
    const adopted = page({ approval: { state: 'ADOPTED', hash: 'h', depth: {}, summary } });
    expect(adopted).not.toMatch(/>\s*Decline\s*</);
    expect(adopted).toMatch(/>\s*Pause\s*</);
    for (const state of ['UNADOPTED', 'CHANGED']) expect(page({ approval: { state, hash: 'h', depth: {}, summary } })).toMatch(/>\s*Decline\s*</);
  });
  it('UX: the Created note does not repeat the next run, and Paused has a space after the dot', () => {
    const html = page({ created: true });
    expect(html).toMatch(/Created\. You approved it by creating it\.\s*</);
    expect(html.match(/Next run:/g)?.length).toBe(1);
    expect(page({ schedule: sched({ enabled: false }) })).toContain('Paused · Every day');
  });
});
