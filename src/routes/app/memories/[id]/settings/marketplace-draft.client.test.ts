/**
 * portal#1248 — an unsaved marketplace-listing tick must survive a REAL
 * sibling save. The discard Charles reproduced in the browser is
 * superForm's page-data subscription: a sibling save's invalidateAll
 * replaces page.data while page.form is still empty, and because this
 * card's form id is STABLE and memory-bound, the fresh load form's id
 * matches — so the data-path rebind overwrites the form store with the
 * persisted flag, taint notwithstanding. The card now opts out with
 * `applyAction: 'never'`; reseeding belongs to its snapshot gate (changed
 * persisted flag) and the `{#key g.id}` remount (memory navigation).
 *
 * The sibling here is the Memory card form (`?/update`), driven through its
 * real superforms handlers (`submitEnhancedDeferred`, #957/#1237) in kit's
 * actual order — page.data replaced wholesale FIRST (the invalidateAll the
 * loader rerun causes), the ActionResult as page.form SECOND — before
 * asserting on the checkbox. Reversing that order is a false green: the
 * page's form branch then shadows its data branch and the rebind never
 * runs (exactly how this file passed over the live defect the first time).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { flushSync } from 'svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import type { Memory } from '$lib/types';
import { memorySettingsSchema } from './schema';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';

vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));

import Page from './+page.svelte';

const CARD = 'form[action="?/updateMarketplaceListing"]';
const MEMORY = 'form#graph-settings';

async function renderSettings(graph: Memory) {
  const forms = await settingsForms(graph);
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph,
      user: OWNER,
      ownerUserId: OWNER_ID,
      owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' },
      org: { id: 'org-1', members: [{ user: { id: OWNER_ID }, role: 'ADMIN' }] },
      allOrgs: [],
      transferCanDelete: false,
      canWriteMemory: true,
      canManageMemory: true,
      orgReadFailed: false,
      ...forms,
    } as never,
    form: null as never,
  });
  setStubPage('http://localhost/app/memories/mem-1/settings', { id: 'mem-1' });
  page.update((p) => ({ ...p, data: props.data as Record<string, unknown> }));
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  return { ...m, props };
}

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function cardBox(target: HTMLElement) {
  return target.querySelector<HTMLFormElement>(CARD)!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
}

function setBox(target: HTMLElement, checked: boolean) {
  const box = cardBox(target);
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

/** The result `?/update` answers with, built as the action does. */
async function memoryOutcome() {
  const validated = await superValidate({}, zod4(memorySettingsSchema), { errors: false });
  validated.message = { type: 'success', text: 'Memory updated.' };
  return { type: 'success' as const, status: 200, data: { form: validated } };
}

/**
 * A real sibling save, in kit's actual order. The enhanced fetch resolves and
 * superforms' own result handler runs: invalidateAll() first — loaders rerun,
 * `__data.json` replaces page.data wholesale (fresh graph, fresh six-form set)
 * while page.form still holds no action data — and only then does applyAction
 * deliver the ActionResult as page.form.
 *
 * The order is load-bearing. An earlier harness delivered the result first,
 * so the stub's applyAction had already set page.form and superForm's page
 * subscription took its form branch, never its data branch — the wholesale
 * data rebind (the discard Charles reproduced in the browser, portal#1248)
 * never ran, and the pin passed green over the live defect.
 */
async function siblingSave(m: { target: HTMLElement; props: Record<string, unknown> }, refreshedGraph: Memory) {
  // The repro's exact gesture: the Memory card form exists only in Edit mode.
  const edit = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit')!;
  edit.click();
  flushSync();
  const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(MEMORY)!);
  const outcome = await memoryOutcome();
  // 1. invalidateAll: page.data replaced wholesale, page.form untouched.
  const forms = await settingsForms(refreshedGraph);
  m.props.data = { ...(m.props.data as Record<string, unknown>), graph: refreshedGraph, ...forms };
  page.update((p) => ({ ...p, data: m.props.data as Record<string, unknown> }));
  m.props.form = outcome.data;
  // 2. applyAction: the sibling's ActionResult becomes page.form.
  await deferred.finish(outcome);
  for (let i = 0; i < 5; i++) await tick();
}

describe('marketplace-listing draft vs a real sibling save (portal#1248)', () => {
  it('keeps an unsaved TICK when the Memory card is saved', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: false }));
    mounted.push(m);
    setBox(m.target, true);
    await siblingSave(m, settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: false }));
    expect(cardBox(m.target).checked).toBe(true);
  });

  it('keeps an unsaved UNTICK when the Memory card is saved', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: true }));
    mounted.push(m);
    setBox(m.target, false);
    await siblingSave(m, settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: true }));
    expect(cardBox(m.target).checked).toBe(false);
  });

  // #1163 discipline, kept: when the refreshed data DOES carry a different
  // persisted flag, the toggle reseeds to the server's answer. The toggle is
  // left UNTOUCHED so reseed and retained draft diverge: on a boolean a flip
  // always equals the draft, so a drafted shape cannot tell a reseed from a
  // kept draft — a never-reseed card passed it (Gil's P2 on #1254). Only an
  // untouched toggle whose persisted flag flips discriminates.
  it('reseeds when the persisted flag changed behind the sibling save', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: false }));
    mounted.push(m);
    await siblingSave(m, settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: true }));
    expect(cardBox(m.target).checked).toBe(true);
  });

  it('reseeds when the persisted flag changed in the other direction', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: true }));
    mounted.push(m);
    await siblingSave(m, settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: false }));
    expect(cardBox(m.target).checked).toBe(false);
  });

  // #1163 discipline, kept: a memory navigation remounts the keyed card — a
  // draft never carries onto another memory.
  it('remounts fresh on a memory navigation', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: false }));
    mounted.push(m);
    setBox(m.target, true);
    const other = settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: false });
    other.id = 'mem-2';
    const forms = await settingsForms(other);
    m.props.data = { ...(m.props.data as Record<string, unknown>), graph: other, ...forms };
    page.update((p) => ({ ...p, data: m.props.data as Record<string, unknown> }));
    for (let i = 0; i < 5; i++) await tick();
    expect(cardBox(m.target).checked).toBe(false);
  });
});
