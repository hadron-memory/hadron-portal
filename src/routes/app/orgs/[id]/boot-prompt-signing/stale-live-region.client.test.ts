/**
 * portal#2398 (follow-up to #2375 part B) — the stale switch-on message is announced from a
 * region that already exists, whatever preview the reload brings back.
 *
 * The message used to sit inside the `preview.kind === 'ok'` branch of the page's preview chain.
 * A stale switch-on replaces the preview with the freshly loaded one, which may be `drifted` or
 * `too_many`, so the enclosing branch was replaced by the result itself: the region was unmounted
 * while a populated one appeared in the new branch. Now main's section-level region (#2379) also
 * carries the stale outcome, and the `drifted` branch does not repeat the text.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, idleStatusAtMount, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { firstPopulatedStatusText } from '$lib/test/firstPopulatedStatusText';
import Page from './+page.svelte';

const STALE = 'What would change has changed, or this review is more than 10 minutes old.';
const org = { id: 'org-1', name: 'Acme', urn: 'hrn:org:acme.com' };
const row = (n: number) => ({
  appId: `a${n}`, appUrn: `hrn:app:acme.com:app-${n}`, agentId: `g${n}`, agentName: `Agent ${n}`,
  workerId: null, workerName: null, agentUrn: null, workerUrn: null, compiledNodeId: `n${n}`, compiledNodeUrn: null,
  servedRevSeq: 4, state: 'UNSIGNED_STOPS', changesToRevSeq: null,
});
const ok = (token: string, rows: unknown[]) => ({ kind: 'ok', enforced: false, deploymentSigns: true, total: rows.length, rows, previewToken: token });
const sw = { kind: 'ok', required: false, enforced: false, deploymentSigns: true };

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const occurrences = (s: string, needle: string) => s.split(needle).length - 1;

describe.each([
  ['ok', ok('tok-fresh', [row(1), row(2)])],
  ['drifted', { kind: 'drifted' }],
  ['too_many', { kind: 'too_many', total: 900 }],
])('a stale switch-on that reloads a %s preview', (_name, reloaded) => {
  it('speaks once, from the region that existed empty before, the same element after', async () => {
    setStubPage('http://localhost/app/orgs/org-1/boot-prompt-signing');
    const p = reactiveProps<Record<string, unknown>>({ data: { org, sw, preview: ok('tok-loaded', [row(1)]) }, form: null });
    mounted = mountComponent(Page as never, p as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const root = mounted.target;
    const idle = idleStatusAtMount(root);
    expect(idle.length, 'a status region exists, empty, at mount').toBeGreaterThan(0);
    expect(firstPopulatedStatusText(root)).toBeNull();

    const form = root.querySelector('form[action="?/switchOn"]') as HTMLFormElement;
    await submitEnhancedWithResult(form, { type: 'failure', status: 409, data: { outcome: 'stale', preview: reloaded } });
    p.form = { outcome: 'stale', preview: reloaded };
    flushSync(); await tick();

    // the too_many branch has its own, unrelated status line: pick the region that carries the stale text
    const during = [...root.querySelectorAll<HTMLElement>('[role="status"]')].find((r) => r.textContent?.includes(STALE))!;
    expect(during, 'a status region carries the stale message').toBeDefined();
    expect(during.textContent).toContain(STALE);
    expect(idle, 'the announcing region is one that already existed').toContain(during);
    expect(occurrences(root.textContent ?? '', STALE), 'the text is not repeated by the reloaded branch').toBe(1);

    p.form = null;
    flushSync(); await tick();
    expect([...root.querySelectorAll('[role="status"]')]).toContain(during);
    // The note outlives the form result only where the reloaded preview is itself the note (drifted,
    // too_many); for ok the region empties. Either way it is the same element, never remounted.
    if (_name === 'ok') expect(during.textContent?.trim()).toBe('');
    else expect(during.textContent?.trim()).not.toBe('');
  });
});
