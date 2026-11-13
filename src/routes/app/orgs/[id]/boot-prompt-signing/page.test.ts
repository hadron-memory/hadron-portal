/**
 * portal#1921 — SSR markup of the preview/switch-on route and the Profile
 * tab's signing section. The server render is enough for markup (what a state
 * says, what is absent); behaviour in the component lifecycle is not claimed here.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
vi.mock('$app/forms', () => import('$lib/test/stubs/app-forms'));
vi.mock('$app/environment', () => import('$lib/test/stubs/app-environment-ssr'));

import PreviewPage from './+page.svelte';
import ProfilePage from '../+page.svelte';
import { orgProfileSchema } from '../schema';

const org = { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' };
const row = (n: number, over: Record<string, unknown> = {}) => ({
  appId: `a${n}`, appUrn: `hrn:app:acme.com:app-${n}`, agentId: `g${n}`, agentName: `Agent ${n}`,
  workerId: null, workerName: null, agentUrn: null, workerUrn: null, compiledNodeId: `n${n}`, compiledNodeUrn: `hrn:node:acme.com:m:boot-${n}`,
  servedRevSeq: 4, state: 'UNSIGNED_STOPS', changesToRevSeq: null, ...over,
});
const ok = (rows: unknown[], over: Record<string, unknown> = {}) => ({
  kind: 'ok', enforced: false, deploymentSigns: true, total: rows.length, rows, previewToken: 'tok-shown', ...over,
});
const sw = (required: boolean, enforced: boolean, deploymentSigns = true) => ({ kind: 'ok', required, enforced, deploymentSigns });
const preview = (data: Record<string, unknown>, form: unknown = null) =>
  render(PreviewPage as never, { props: { data: { org, sw: sw(false, false), preview: null, ...data }, form } as never }).body;

describe('preview page', () => {
  it('lists the rows with the three states in plain words and carries the shown token', () => {
    const body = preview({
      preview: ok([
        row(1),
        row(2, { state: 'SIGNATURE_PENDING' }),
        row(3, { state: 'REVISION_CHANGES', changesToRevSeq: 2, workerId: 'w', workerName: 'Wren' }),
      ]),
    });
    expect(body).toContain('Switching on would change 3 boot prompts.');
    expect(body).toContain('Stops: no signed revision');
    expect(body).toContain('Waiting on a signature (stops until it counts)');
    expect(body).toContain('Falls back to revision 2');
    expect(body).toContain('Wren');
    expect(body).toContain('All chats and uncustomised workers');
    expect(body).toContain('hrn:app:acme.com:app-1');
    expect(body).toMatch(/name="previewToken"[^>]*value="tok-shown"|value="tok-shown"[^>]*name="previewToken"/);
    expect(body).not.toMatch(/name="required"/);
    expect(body).toContain('Switch on');
  });

  it('says "1 boot prompt" at one, not "1 boot prompts" (UX P2)', () => {
    expect(preview({ preview: ok([row(1)]) })).toContain('Switching on would change 1 boot prompt.');
    expect(preview({ preview: ok([row(1)]) })).not.toContain('1 boot prompts');
    expect(preview({ preview: { kind: 'too_many', enforced: false, deploymentSigns: true, total: 1 } })).not.toContain('1 boot prompts');
  });

  it('renders the CLI command in <code>, not as backticks in copy (UX P3)', () => {
    const body = preview({ preview: { kind: 'too_many', enforced: false, deploymentSigns: true, total: 5000 } });
    expect(body).toContain('<code');
    expect(body).toContain('hadron org signing on');
    expect(body).not.toContain('`');
  });

  it('switch-on feedback sits directly above the Switch on form, not at the top (UX P3)', () => {
    const body = preview({ preview: ok([row(1)]) }, { outcome: 'failed' });
    expect(body.indexOf('Couldn’t switch signing on')).toBeGreaterThan(body.indexOf('Agent 1'));
    expect(body.indexOf('Couldn’t switch signing on')).toBeLessThan(body.indexOf('?/switchOn'));
  });

  it('shows what happens beside the App, in the first column, not off-screen (QA F1)', () => {
    const body = preview({ preview: ok([row(1)]) });
    const firstRow = body.slice(body.indexOf('hrn:app:acme.com:app-1'));
    expect(firstRow.indexOf('Stops: no signed revision')).toBeGreaterThan(-1);
    expect(firstRow.indexOf('Stops: no signed revision')).toBeLessThan(firstRow.indexOf('Agent 1'));
  });

  it('an empty preview says nothing would change and still offers Switch on', () => {
    const body = preview({ preview: ok([], { previewToken: 'tok-empty' }) });
    expect(body).toContain('Nothing would change.');
    expect(body).toContain('value="tok-empty"');
  });

  it('says plainly that this deployment does not sign when it does not', () => {
    const body = preview({ preview: ok([row(1)], { deploymentSigns: false }) });
    expect(body).toContain('doesn’t sign boot prompts yet');
  });

  it('above the bound shows the total and offers NO switch-on form', () => {
    const body = preview({ preview: { kind: 'too_many', enforced: false, deploymentSigns: true, total: 5000 } });
    expect(body).toContain('Switching on would change 5000 boot prompts.');
    expect(body).toContain('use the CLI');
    expect(body).not.toContain('previewToken');
    expect(body).not.toContain('?/switchOn');
  });

  it('drift shows the stale copy and no switch-on form', () => {
    const body = preview({ preview: { kind: 'drifted' } });
    expect(body).toContain('Look again before switching on.');
    expect(body).not.toContain('?/switchOn');
  });

  it('a stale switch-on shows the fixed copy, over the preview the loader just reloaded', () => {
    // A native (no-JS) POST re-runs the load, so `data.preview` is already the fresh one; the
    // enhanced path swaps the reloaded preview in from its submit callback (page.client.test.ts).
    const body = preview({ preview: ok([row(1), row(2)], { previewToken: 'tok-fresh' }) }, { outcome: 'stale' });
    expect(body).toContain('Look again before switching on.');
    expect(body).toContain('value="tok-fresh"');
  });

  it('already required shows the state and no preview, no form (R5)', () => {
    const body = preview({ sw: sw(true, false), preview: null });
    expect(body).toContain('Required, not enforced');
    expect(body).not.toContain('?/switchOn');
    expect(body).not.toContain('previewToken');
  });

  it('a failed read renders fixed copy, no form', () => {
    const body = preview({ sw: { kind: 'failed' }, preview: null });
    expect(body).toContain('Couldn’t load boot prompt signing.');
    expect(body).not.toContain('?/switchOn');
  });
});

async function profile(data: Record<string, unknown>, form: unknown = null) {
  const f = await superValidate({ name: 'Acme', urn: 'acme.com' }, zod4(orgProfileSchema), { errors: false });
  const fullOrg = { ...org, createdAt: '2026-01-01T00:00:00Z', members: [], subscriptions: [], memories: [], agents: [] };
  return render(ProfilePage as never, { props: { data: { org: fullOrg, currentUserId: 'u1', form: f, signing: { kind: 'hidden' }, ...data }, form } as never }).body;
}

describe('Profile tab: signing section', () => {
  it('required-but-not-enforced is distinct from enforced', async () => {
    const notEnforced = await profile({ signing: sw(true, false, false) });
    const enforced = await profile({ signing: sw(true, true) });
    expect(notEnforced).toContain('Required, not enforced');
    expect(notEnforced).toContain('not enforced: this deployment doesn’t sign');
    expect(notEnforced).not.toContain('Required and enforced');
    expect(enforced).toContain('Required and enforced');
    expect(enforced).not.toContain('Required, not enforced');
  });

  it('off offers the review link; on offers Switch off and no preview link (R5)', async () => {
    const off = await profile({ signing: sw(false, false) });
    expect(off).toContain('/app/orgs/org-1/boot-prompt-signing');
    expect(off).not.toContain('Switch off');
    const on = await profile({ signing: sw(true, false) });
    expect(on).not.toContain('/boot-prompt-signing');
    expect(on).toContain('Switch off');
  });

  it('hidden renders no section, no heading, no state word', async () => {
    const body = await profile({ signing: { kind: 'hidden' } });
    expect(body).not.toContain('Boot prompt signing');
    expect(body).not.toContain('signing');
    expect(body).not.toContain('enforced');
  });

  it('hidden after a switch-off refusal also removes the section', async () => {
    const body = await profile({ signing: sw(true, true) }, { signingOutcome: 'hidden' });
    expect(body).not.toContain('Boot prompt signing');
  });

  it('failed shows one neutral line naming no state', async () => {
    const body = await profile({ signing: { kind: 'failed' } });
    expect(body).toContain('Couldn’t load boot prompt signing.');
    expect(body).not.toContain('enforced');
    expect(body).not.toContain('Switch on');
  });
});

describe('portal#2067: Agent and Worker URN chips under the names', () => {
  const chips = (body: string) => [...body.matchAll(/title="Copy ([a-z]+) URN"/g)].map((m) => m[1]);
  it('a worker row shows an agent chip and a worker chip, each below its name', () => {
    const body = preview({
      preview: ok([row(1, { agentName: 'Atlas', agentUrn: 'hrn:agent:acme.com:zz-unrelated', workerId: 'w', workerName: 'Wren', workerUrn: 'hrn:worker:acme.com:app-1:wren-slug' })]),
    });
    expect(chips(body)).toEqual(expect.arrayContaining(['agent', 'worker']));
    expect(body.indexOf('zz-unrelated')).toBeGreaterThan(body.indexOf('Atlas'));
    expect(body.indexOf('wren-slug')).toBeGreaterThan(body.indexOf('Wren'));
  });
  it('an install-level row shows the agent chip and NO worker chip', () => {
    const body = preview({ preview: ok([row(1, { agentUrn: 'hrn:agent:acme.com:ag-1' })]) });
    expect(chips(body)).toContain('agent');
    expect(chips(body)).not.toContain('worker');
  });
  it('null URNs render the names alone: no chip, no fallback text', () => {
    const body = preview({ preview: ok([row(1, { workerId: 'w', workerName: 'Wren' })]) });
    expect(chips(body)).not.toContain('agent');
    expect(chips(body)).not.toContain('worker');
    expect(body).toContain('Agent 1');
    expect(body).toContain('Wren');
  });
});

describe('portal#2074: the worker chip follows workerUrn, and positions are checked per cell', () => {
  // Coupling, on purpose: these tests read the SSR markup. They assume each value sits in its own <td>, that a
  // name line is `<div class="truncate">`, and that the name renders before its URN chip. If the cell markup
  // changes, update `cells` and the truncate regex below rather than loosening the assertions.
  const cells = (body: string) => [...body.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
  const cellWith = (body: string, needle: string) => cells(body).filter((c) => c.includes(needle));
  const wrow = { agentName: 'Atlas', agentUrn: 'hrn:agent:acme.com:zz-unrelated', workerId: 'w', workerName: 'Wren', workerUrn: 'hrn:worker:acme.com:app-1:wren-slug' };

  it('each chip sits in the same cell as its name, after it', () => {
    const body = preview({ preview: ok([row(1, wrow)]) });
    // Anchor on the NAME's cell, so a chip moved to another cell leaves the name's cell without it.
    const agentCell = cellWith(body, 'Atlas');
    const workerCell = cellWith(body, 'Wren');
    expect(agentCell).toHaveLength(1);
    expect(workerCell).toHaveLength(1);
    const a = agentCell[0];
    const w = workerCell[0];
    expect(a.indexOf('Atlas')).toBeGreaterThanOrEqual(0);
    expect(a.indexOf('zz-unrelated')).toBeGreaterThan(a.indexOf('Atlas'));
    expect(w.indexOf('Wren')).toBeGreaterThanOrEqual(0);
    expect(w.indexOf('wren-slug')).toBeGreaterThan(w.indexOf('Wren'));
    expect(a).not.toContain('wren-slug');
    expect(w).not.toContain('zz-unrelated');
    // And each chip appears in exactly one cell.
    expect(cellWith(body, 'zz-unrelated')).toHaveLength(1);
    expect(cellWith(body, 'wren-slug')).toHaveLength(1);
  });

  it('a workerUrn with no workerName still shows its chip, under a fallback label that is not derived from the URN', () => {
    const body = preview({ preview: ok([row(1, { ...wrow, workerName: null })]) });
    const cell = cellWith(body, 'wren-slug');
    expect(cell).toHaveLength(1);
    expect(cell[0]).toContain('Unnamed worker');
    expect(cell[0]).not.toContain('All chats and uncustomised workers');
    // The name line is the fixed label, with nothing taken from the slug.
    expect(/<div class="truncate">([^<]*)<\/div>/.exec(cell[0])?.[1]).toBe('Unnamed worker');
  });

  it('a worker name with no URN is name-only, and an install row keeps its label with no chip', () => {
    const named = cellWith(preview({ preview: ok([row(1, { ...wrow, workerUrn: null })]) }), 'Wren');
    expect(named).toHaveLength(1);
    expect(named[0]).not.toContain('Copy worker URN');
    const install = preview({ preview: ok([row(1)]) });
    expect(cellWith(install, 'All chats and uncustomised workers')).toHaveLength(1);
    expect(install).not.toContain('Copy worker URN');
    expect(install).not.toContain('Unnamed worker');
  });
});
