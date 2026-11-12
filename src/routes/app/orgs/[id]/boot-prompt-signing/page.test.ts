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
  workerId: null, workerName: null, compiledNodeId: `n${n}`, compiledNodeUrn: `hrn:node:acme.com:m:boot-${n}`,
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
