/**
 * portal#2398 (follow-up to #2375 part B) — the adopt result is announced from a region that
 * already exists.
 *
 * The adopt form was a plain POST (#685), so a submit loaded a fresh document and the success
 * `role="status"` was inserted already populated: it could never be "the same element after".
 * `use:enhance` is progressive (the plain POST still works without JavaScript), and with it the
 * result arrives in the SAME document, so the region the page rendered empty is the one that
 * fills. Without JavaScript the result page puts the success box where it is focused on load,
 * because a region present at load is not announced.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, idleStatusAtMount, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion, firstPopulatedStatusText } from '$lib/test/firstPopulatedStatusText';
import { isEnhanced } from '$lib/test/stubs/app-forms';
import Page from './+page.svelte';

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

const data = {
  organizations: { items: [], total: 0 },
  agents: { items: [], total: 0 },
  memories: { items: [
    { id: 'm1', name: 'Kubernetes', urn: 'hrn:mem:acme.test:k8s', description: null },
    { id: 'm2', name: 'Postgres', urn: 'hrn:mem:acme.test:pg', description: null },
  ], total: 2 },
  loadFailed: false,
  adoptTargets: [{ id: 'a1', name: 'Scribe', urn: 'hrn:agent:acme.test:scribe' }],
  adoptTargetsFailed: false,
};
const success = (memoryId: string) => ({
  form: { data: { _kind: 'addToAgent', memoryId, agentId: 'a1' }, message: { type: 'success', text: 'Added to your agent.' }, errors: {}, valid: true },
});

describe('marketplace adopt result is announced from a persistent region', () => {
  it('exists empty before the action, holds the text during, and is the same element after', async () => {
    const p = reactiveProps<Record<string, unknown>>({ data, form: null });
    mounted = mountComponent(Page as never, p as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const root = mounted.target;
    const idle = idleStatusAtMount(root);
    expect(idle.length, 'a status region exists, empty, at mount').toBeGreaterThan(0);
    expect(firstPopulatedStatusText(root)).toBeNull();

    p.form = success('m2');
    flushSync(); await tick();
    const during = announcedStatusRegion(root)!;
    expect(during.textContent).toContain('Added to your agent.');
    expect(idle, 'the announcing region is one that already existed').toContain(during);
    // an enhanced result must not steal focus: only the no-JavaScript landing page is a focus target
    expect((during.firstElementChild as HTMLElement).hasAttribute('autofocus')).toBe(false);

    p.form = null;
    flushSync(); await tick();
    expect([...root.querySelectorAll('[role="status"]')]).toContain(during);
    expect(during.textContent?.trim()).toBe('');
  });

  it('every adopt form is progressively enhanced, so the result arrives in this document', async () => {
    mounted = mountComponent(Page as never, { data, form: null } as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const forms = [...mounted.target.querySelectorAll<HTMLFormElement>('form[action="?/addToAgent"]')];
    expect(forms).toHaveLength(2);
    for (const f of forms) expect(isEnhanced(f), 'use:enhance on the adopt form').toBe(true);
  });

  it('a result already on the page at load (no JavaScript) is a focus target, and only that one', async () => {
    mounted = mountComponent(Page as never, { data, form: success('m2') } as never) as Mounted<Record<string, unknown>>;
    await tick(2);
    const box = announcedStatusRegion(mounted.target)!.firstElementChild as HTMLElement;
    expect(box.textContent).toContain('Added to your agent.');
    expect(box.getAttribute('tabindex')).toBe('-1');
    expect(box.hasAttribute('autofocus') || document.activeElement === box, 'focused or marked to be focused on load').toBe(true);
  });
});
