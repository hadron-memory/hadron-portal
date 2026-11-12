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
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';

const org = { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' };
const row = (n: number) => ({
  appId: `a${n}`, appUrn: `hrn:app:acme.com:app-${n}`, agentId: `g${n}`, agentName: `Agent ${n}`,
  workerId: null, workerName: null, compiledNodeId: `n${n}`, compiledNodeUrn: null,
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
