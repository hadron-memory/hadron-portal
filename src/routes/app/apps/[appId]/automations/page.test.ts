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
function list(approvals: unknown, over: Record<string, unknown> = {}) {
  return render(List as never, { props: { data: { app, approvals, after: null, ...over } } } as never).body;
}
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
    const html = list(ok([row({ name: '<img src=x onerror=alert(1)>', headline: '<b>bold</b> **md** [x](javascript:alert(1))' })]));
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
});
