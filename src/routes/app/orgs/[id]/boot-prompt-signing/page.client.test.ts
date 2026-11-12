/**
 * portal#1921 — the preview route's interaction, in the client lane: which
 * preview (and which token) the page holds across CONSECUTIVE submissions, and
 * that a rejected kit update never leaves the submit latched.
 *
 * Found by the BLIND seat (P2): after a stale submit supplied a fresh preview, a
 * failed retry fell back to the loader's stale preview and re-posted its expired
 * token. SSR cannot see it; the result handler only runs when mounted.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { beginEnhanced, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';

const org = { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' };
const row = (n: number) => ({
  appId: `a${n}`, appUrn: `hrn:app:acme.com:app-${n}`, agentId: `g${n}`, agentName: `Agent ${n}`,
  workerId: null, workerName: null, agentUrn: null, workerUrn: null, compiledNodeId: `n${n}`, compiledNodeUrn: null,
  servedRevSeq: 4, state: 'UNSIGNED_STOPS', changesToRevSeq: null,
});
const ok = (token: string, rows: unknown[]) => ({
  kind: 'ok', enforced: false, deploymentSigns: true, total: rows.length, rows, previewToken: token,
});
const sw = { kind: 'ok', required: false, enforced: false, deploymentSigns: true };

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
});
function mountPage(preview: unknown) {
  setStubPage('http://localhost/app/orgs/org-1/boot-prompt-signing');
  mounted = mountComponent(Page as never, { data: { org, sw, preview }, form: null } as never);
  return mounted.target;
}
const form = (t: HTMLElement) => t.querySelector('form[action="?/switchOn"]') as HTMLFormElement;
const tokenOf = (t: HTMLElement) => (t.querySelector('input[name="previewToken"]') as HTMLInputElement).value;

describe('which preview and token the page holds', () => {
  it('starts with the loaded preview token', () => {
    expect(tokenOf(mountPage(ok('tok-loaded', [row(1)])))).toBe('tok-loaded');
  });

  it('a stale result swaps in the reloaded preview and its fresh token', async () => {
    const t = mountPage(ok('tok-loaded', [row(1)]));
    await submitEnhancedWithResult(form(t), { type: 'failure', status: 409, data: { outcome: 'stale', preview: ok('tok-fresh', [row(1), row(2)]) } });
    flushSync();
    await tick();
    expect(tokenOf(t)).toBe('tok-fresh');
    expect(t.textContent).toContain('would change 2 boot prompts');
  });

  it('a FAILED retry after a stale keeps the fresh preview, never the loader\'s expired one (BLIND P2)', async () => {
    const t = mountPage(ok('tok-loaded', [row(1)]));
    await submitEnhancedWithResult(form(t), { type: 'failure', status: 409, data: { outcome: 'stale', preview: ok('tok-fresh', [row(1), row(2)]) } });
    flushSync();
    await submitEnhancedWithResult(form(t), { type: 'failure', status: 500, data: { outcome: 'failed' } });
    flushSync();
    await tick();
    expect(tokenOf(t)).toBe('tok-fresh');
    expect(t.textContent).not.toContain('would change 1 boot prompt');
  });
});

describe('the submit latch', () => {
  it('a kit update that rejects does not leave Switch on disabled (Gene P3)', async () => {
    const t = mountPage(ok('tok-loaded', [row(1)]));
    await submitEnhancedWithResult(form(t), { type: 'failure', status: 500, data: { outcome: 'failed' } }, { update: async () => { throw new Error('update failed'); } }).catch(() => {});
    flushSync();
    await tick();
    expect((t.querySelector('button[type="submit"]') as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('a late response is fenced to the submission it answers (LOCAL P2 F2)', () => {
  it('org A\'s late STALE never replaces org B\'s preview after a param-only navigation', async () => {
    setStubPage('http://localhost/app/orgs/org-a/boot-prompt-signing');
    const props = reactiveProps<Record<string, unknown>>({ data: { org, sw, preview: ok('tok-org-A', [row(1)]) }, form: null });
    mounted = mountComponent(Page as never, props as never);
    const t = mounted.target;
    const deliver = await beginEnhanced(form(t), { update: async () => {} });
    // The page is reused for org B before A's response lands.
    props.data = { org: { ...org, id: 'org-b' }, sw, preview: ok('tok-org-B', [row(2)]) };
    flushSync();
    await tick();
    expect(tokenOf(t)).toBe('tok-org-B');
    await deliver({ type: 'failure', status: 409, data: { outcome: 'stale', preview: ok('tok-late-A', [row(1), row(3)]) } });
    flushSync();
    await tick();
    expect(tokenOf(t)).toBe('tok-org-B');
  });

  it('control: the same org\'s stale response still swaps in', async () => {
    setStubPage('http://localhost/app/orgs/org-a/boot-prompt-signing');
    const props = reactiveProps<Record<string, unknown>>({ data: { org, sw, preview: ok('tok-org-A', [row(1)]) }, form: null });
    mounted = mountComponent(Page as never, props as never);
    const t = mounted.target;
    const deliver = await beginEnhanced(form(t), { update: async () => {} });
    await deliver({ type: 'failure', status: 409, data: { outcome: 'stale', preview: ok('tok-fresh-A', [row(1), row(3)]) } });
    flushSync();
    await tick();
    expect(tokenOf(t)).toBe('tok-fresh-A');
  });
});

describe('portal#2067: the chip carries the server string byte for byte', () => {
  it('copying the agent and worker chips writes the fixture URNs unchanged', async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (v: string) => { written.push(v); } } });
    const agentUrn = 'hrn:agent:other.org:zz-unrelated-slug';
    const workerUrn = 'hrn:worker:acme.com:app-1:wren-slug-9';
    const t = mountPage(ok('tok', [{ ...row(1), agentName: 'Atlas', agentUrn, workerId: 'w', workerName: 'Wren', workerUrn }]));
    (t.querySelector('button[title="Copy agent URN"]') as HTMLButtonElement).click();
    (t.querySelector('button[title="Copy worker URN"]') as HTMLButtonElement).click();
    expect(written).toEqual([agentUrn, workerUrn]);
  });
});
