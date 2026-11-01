/**
 * portal#1142 S8 — the worker page's boot-prompt pointer, mounted.
 * - Gaia's P2-1 on #1246: the form follows the worker's APP manager audit
 *   alone; whether anyone holds the worker, the viewer included, changes
 *   nothing (R23: holding grants nothing).
 * - George's P2 on #1246: the form is re-keyed per worker, so a draft typed
 *   for worker A never sits in worker B's form after a reused navigation.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateSignatureSchema } from './schema';
import Page from './+page.svelte';

const VIEWER = 'u1';

function worker(id: string, heldByUserId: string | null) {
  return {
    hasLiveSession: false,
    id, appId: 'app-1', agentId: 'agent-1', name: `Worker ${id}`, slug: id, urn: `hrn:worker:a.com:team:${id}`,
    role: 'engineer', prompt: 'P', memoryId: null, retiredAt: null,
    heldByUserId, heldAt: heldByUserId ? '2026-10-21T00:00:00Z' : null, createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:a.com:engineer', },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:a.com:team', organizationId: 'org-1' },
  };
}

async function dataFor(w: ReturnType<typeof worker>, canManageWorkerApp: boolean | null) {
  return {
    worker: w,
    user: { id: VIEWER },

    signatureForm: await superValidate({}, zod4(updateSignatureSchema), { errors: false }),
    initialTab: 'briefing', initialView: null,
    workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
    bootPointer: { ok: true, ref: null, deleted: null },
    canManageWorkerApp,
    bootPointerKey: w.id,
  };
}

const mounted: Array<Mounted<Record<string, unknown>>> = [];
beforeEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetNavigationGuards();
  setStubPage('https://example.test/app/workers/w-a?tab=briefing', { id: 'w-a' });
});

async function mountWorker(props: Record<string, unknown>) {
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}
const pointerForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action*="/setBootPrompt"]');
const input = (root: HTMLElement) => root.querySelector<HTMLInputElement>('#worker-boot-pointer-node-ref');

describe('Worker Boot briefing: boot-prompt pointer (portal#1142 S8)', () => {
  it.each([
    ['nobody holds it', null],
    ['someone else holds it', 'someone-else'],
    ['the viewer holds it', VIEWER],
  ])('the App manager gets the form when %s', async (_label, holder) => {
    const root = await mountWorker({ data: await dataFor(worker('w-a', holder), true), form: null });
    expect(pointerForm(root)).not.toBeNull();
  });

  it.each([
    ['nobody holds it', null],
    ['the viewer holds it', VIEWER],
  ])('an explicit non-manager gets no form when %s: holding grants nothing', async (_label, holder) => {
    const root = await mountWorker({ data: await dataFor(worker('w-a', holder), false), form: null });
    expect(pointerForm(root)).toBeNull();
    expect(root.textContent).toContain('Agents start with the newest approved revision of the compiled prompt named by the highest set pointer: the worker’s, else the App’s, else the Agent’s.');
  });

  it('the form carries the Boot briefing tab, so a no-JS result lands where it shows', async () => {
    const root = await mountWorker({ data: await dataFor(worker('w-a', null), null), form: null });
    expect(pointerForm(root)!.getAttribute('action')).toBe('?tab=briefing&/setBootPrompt');
  });

  it('navigating to another worker clears a draft typed for the first', async () => {
    const props = reactiveProps({ data: await dataFor(worker('w-a', null), true), form: null } as Record<string, unknown>);
    const root = await mountWorker(props);
    input(root)!.value = 'draft-for-worker-a';
    input(root)!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(input(root)!.value).toBe('draft-for-worker-a');

    setStubPage('https://example.test/app/workers/w-b?tab=briefing', { id: 'w-b' });
    props.data = await dataFor(worker('w-b', null), true);
    flushSync();
    await tick(2);
    expect(input(root)!.value).toBe('');
  });

  // Xylon on #1246: a loader refresh for the SAME worker keeps what was typed.
  it('a same-worker loader refresh keeps the draft', async () => {
    const props = reactiveProps({ data: await dataFor(worker('w-a', null), true), form: null } as Record<string, unknown>);
    const root = await mountWorker(props);
    input(root)!.value = 'draft-kept';
    input(root)!.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    props.data = { ...(await dataFor(worker('w-a', 'someone-else'), true)), bootPointer: { ok: true, ref: 'hrn:node:a.com:install:boot', deleted: false } };
    flushSync();
    await tick(2);
    expect(input(root)!.value).toBe('draft-kept');
    expect(root.querySelector('[title="hrn:node:a.com:install:boot"]')).not.toBeNull();
  });

  it('a result for another worker is never shown', async () => {
    const refusal = { code: 'FORBIDDEN', lead: 'Only this App’s manager can change this pointer.', message: 'No.' };
    const root = await mountWorker({ data: await dataFor(worker('w-b', null), true), form: { pointer: { key: 'w-a', nodeRef: 'draft-a', refusal } } });
    expect(root.querySelector('[data-testid="boot-pointer-refusal"]')).toBeNull();
    expect(input(root)!.value).toBe('');
  });
});
