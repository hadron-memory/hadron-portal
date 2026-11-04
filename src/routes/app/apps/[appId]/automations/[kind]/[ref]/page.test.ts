/**
 * portal#1299 — the approval page, rendered on the server: plain sentences,
 * the state the server computed, Approve carrying the displayed hash, and
 * others' text kept as text.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }), applyAction: vi.fn(), deserialize: vi.fn() }));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
import Page from './+page.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const summary = (over: Record<string, unknown> = {}) => ({
  name: 'Nightly digest', schedule: 'Runs on the schedule "0 6 * * *" (UTC). The schedule can change without a new approval.',
  reads: ['Everything this App can read; there is no user attached, so nothing personal.'],
  writes: ['Digest: creates a new record node "runs:<run id>" beside the entry node for each run.'],
  tools: ['hadron_find_nodes'], limits: ['Set by the platform when a run starts.'], cannotDo: ['Never reads a private memory.'],
  flows: [{ name: 'Digest', urn: 'hrn:node:acme.com:team:flows:digest', tools: ['hadron_find_nodes'], writes: [] }], ...over,
});
const approval = (over: Record<string, unknown> = {}) => ({ state: 'UNADOPTED', hash: 'hash-abc123', depth: { entryId: 'n1' }, summary: summary(), ...over });
function page(over: Record<string, unknown> = {}, form: unknown = null) {
  return render(Page as never, { props: { data: { app, kind: 'SCHEDULE', ref: 'sch-1', approval: approval(), teamGrant: { status: 'hidden' }, ...over }, form } } as never).body;
}
const hashInput = (html: string) => html.match(/<input[^>]*name="expectedHash"[^>]*>/)?.[0] ?? '';

describe('approval page', () => {
  it('reads as plain sentences: what it reads, writes, cannot do, tools, schedule and limits', () => {
    const html = page();
    for (const s of ['Nightly digest', 'Everything this App can read', 'creates a new record node', 'Never reads a private memory.', 'hadron_find_nodes', 'Runs on the schedule', 'Set by the platform']) expect(html).toContain(s);
  });

  it('an unapproved automation offers Approve and Decline, and says it is waiting', () => {
    const html = page();
    expect(html).toContain('Waiting for approval');
    expect(html).toMatch(/>\s*Approve\s*</);
    expect(html).toMatch(/>\s*Decline\s*</);
  });

  it('shows CHANGED when the server says so, and still offers Approve against the hash it computed', () => {
    const html = page({ approval: approval({ state: 'CHANGED', hash: 'hash-new' }) });
    expect(html).toContain('Changed since it was approved');
    expect(html).toMatch(/>\s*Approve\s*</);
    expect(hashInput(html)).toContain('value="hash-new"');
  });

  it('Approve carries exactly the hash the page showed', () => {
    expect(hashInput(page())).toContain('value="hash-abc123"');
  });

  it('an approved automation shows Approved and offers Decline only', () => {
    const html = page({ approval: approval({ state: 'ADOPTED' }) });
    expect(html).toContain('Approved');
    expect(html).not.toMatch(/>\s*Approve\s*</);
    expect(html).toMatch(/>\s*Decline\s*</);
  });

  it('renders a schedule the server could not state as "not stated", never an empty field', () => {
    const html = page({ approval: approval({ summary: summary({ schedule: null }) }) });
    expect(html).toMatch(/not stated/i);
  });

  it('shows "not stated" for a blank sentence, and "None" for a list the server sent empty', () => {
    const html = page({ approval: approval({ summary: summary({ schedule: '   ', tools: [] }) }) });
    expect(html).toMatch(/not stated/i);
    expect(html).toMatch(/None/);
  });

  it('keeps the graph and hash behind Show details, collapsed', () => {
    const html = page();
    expect(html).toMatch(/<details(?![^>]*\bopen\b)/);
    expect(html).toContain('Show details');
    expect(html).toContain('hash-abc123');
  });

  it('keeps others’ text as text: names, sentences and flow names with markup stay inert', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const html = page({ approval: approval({ summary: summary({ name: evil, schedule: '<b>x</b>', reads: ['**r**'], flows: [{ name: evil, urn: 'u', tools: [evil], writes: [evil] }] }) }) });
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>x</b>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)>');
    expect(html).toContain('**r**');
  });

  it('after a stale refusal shows the new summary and says to review it, with Approve again, and no auto-submit', () => {
    const html = page({ approval: approval({ hash: 'hash-new', summary: summary({ name: 'Nightly digest v2' }) }) }, { code: 'stale' });
    expect(html).toContain('Nightly digest v2');
    expect(html).toContain('changed while you were reviewing it');
    expect(hashInput(html)).toContain('value="hash-new"');
    expect(html).not.toMatch(/<form[^>]*\bautofocus|requestSubmit/);
  });

  it('shows a refusal in a role=alert with the server’s words as text', () => {
    const html = page({}, { code: 'refused', message: 'You cannot read <b>a memory</b>' });
    expect(html).toMatch(/role="alert"[^>]*>[^<]*You cannot read &lt;b>a memory&lt;\/b>/);
  });

  it('a refusal that arrives without words still says something, in the alert', () => {
    const html = page({}, { code: 'refused', message: '' });
    expect(html).toMatch(/role="alert"[^>]*>[^<]*\S/);
    expect(html).toContain('The server refused this action.');
  });
});

// portal#1650: the automation's team snapshot grant.
describe('team roster and tasks', () => {
  const person = { name: 'Ana', urn: 'hrn:user:ana' };
  const live = { id: 'g1', createdAt: '2026-11-01T10:00:00.000Z', revokedAt: null, givenBy: person, endedBy: null };
  const ready = (over: Record<string, unknown> = {}) => ({ teamGrant: { status: 'ready', live: null, ended: null, ...over } });
  const HEADING = 'Team roster and tasks';

  it('a viewer the list refuses sees no section at all: no heading, no control, no "off"', () => {
    const html = page({ teamGrant: { status: 'hidden' } });
    expect(html).not.toContain(HEADING);
    expect(html).not.toContain('?/give');
    expect(html).not.toContain('?/stop');
    expect(html).not.toContain('Not given');
  });

  it('a refusal survives the re-read hiding the section: what happened is still said (QA P2)', () => {
    const html = page({ teamGrant: { status: 'hidden' } }, { teamGrantRefused: true, teamGrantMessage: 'Only a manager can give this.' });
    expect(html).toContain('Only a manager can give this.');
    expect(html).not.toContain(HEADING);
    expect(html).not.toContain('?/give');
    expect(html).not.toContain('Not given');
  });

  it('a refusal survives the re-read failing: the section keeps saying what happened', () => {
    const html = page({ teamGrant: { status: 'unavailable' } }, { teamGrantRefused: true, teamGrantMessage: 'Only a manager can give this.' });
    expect(html).toContain('Only a manager can give this.');
    expect(html).toContain('data-testid="team-grant-unavailable"');
  });

  it('a hidden section with nothing to say leaves nothing behind', () => {
    expect(page({ teamGrant: { status: 'hidden' } })).not.toContain('team-grant-outcome');
  });

  it('a failed read says so and offers nothing: it is not "not given"', () => {
    const html = page({ teamGrant: { status: 'unavailable' } });
    expect(html).toContain(HEADING);
    expect(html).toContain('data-testid="team-grant-unavailable"');
    expect(html).not.toContain('Not given');
    expect(html).not.toContain('?/give');
    expect(html).not.toContain('?/stop');
  });

  it('not given: the plain line, one heading, and Give in its own form', () => {
    const html = page(ready());
    expect(html.split(HEADING)).toHaveLength(2);
    expect(html).toContain('this App&#39;s team roster and tasks. Read-only, this App only.'.replace('&#39;', "'"));
    expect(html).toContain('Not given');
    expect(html).toMatch(/<form[^>]*action="\?\/give"/);
    expect(html).not.toContain('?/stop');
  });

  it('given: who and when, their URN, and Stop with what stopping means', () => {
    const html = page(ready({ live }));
    expect(html).toContain('Given by Ana on Nov 1, 2026');
    expect(html).toContain('hrn:user:ana');
    expect(html).toMatch(/<form[^>]*action="\?\/stop"/);
    expect(html).not.toContain('?/give');
    expect(html).toContain('You can give it again, which makes a new grant.');
    expect(html).not.toContain('Not given');
  });

  it('Stop posts no grant id: the server side finds it from the URL', () => {
    const html = page(ready({ live }));
    const form = html.match(/<form[^>]*action="\?\/stop"[\s\S]*?<\/form>/)?.[0] ?? '';
    expect(form).not.toBe('');
    expect(form).not.toContain('<input');
  });

  it('a giver the viewer may not read says so, with no chip', () => {
    const html = page(ready({ live: { ...live, givenBy: null } }));
    expect(html).toContain('Given by a person not visible to you on Nov 1, 2026');
    expect(html).not.toContain('hrn:user:');
  });

  it('ended grants stay behind "Show ended", which keeps this page', () => {
    const html = page(ready());
    expect(html).toContain('Show ended');
    expect(html).toContain('href="/app/apps/app-1/automations/schedule/sch-1?ended=1"');
    expect(html).not.toContain('Hide ended');
  });

  it('a manager who asked for ended grants can put them away; none is said plainly', () => {
    const html = page(ready({ ended: [] }));
    expect(html).toContain('Hide ended');
    expect(html).toContain('href="/app/apps/app-1/automations/schedule/sch-1"');
    expect(html).toContain('No ended grants.');
  });

  it('feedback sits with this section, never in the approval outcome', () => {
    const html = page(ready({ live }), { teamGrantRefused: true, teamGrantMessage: 'Not yours to stop.' });
    const section = html.slice(html.indexOf(HEADING));
    expect(section).toContain('Not yours to stop.');
    expect(html.slice(0, html.indexOf(HEADING))).not.toContain('Not yours to stop.');
  });

  it('a refusal with no words of its own gets a fixed sentence', () => {
    expect(page(ready(), { teamGrantRefused: true, teamGrantMessage: '' })).toContain('The server refused this action.');
  });

  it.each([['given', 'Given.'], ['stopped', 'Stopped.']])('%s is confirmed beside the control', (outcome, words) => {
    expect(page(ready(), { teamGrant: outcome })).toContain(words);
  });
});
