/**
 * portal#1248 — an unsaved marketplace-listing tick must survive a REAL
 * sibling save. The mounted tests on the card (marketplace-save) deliver a
 * sibling's ActionResult but never replace `data`, so the loader refresh a
 * real save triggers (invalidateAll → all load functions rerun → fresh page
 * data with a fresh marketplaceForm) was never exercised — which is exactly
 * the discard Cooper's QA saw on #1244: save the Memory card, the unsaved
 * tick is gone.
 *
 * The sibling here is the Memory card form (`?/update`), driven through its
 * real superforms handlers (`submitEnhancedWithResult`, #957), then the page
 * data is replaced wholesale the way the loader rerun does — new `graph`
 * object, fresh six-form set — before asserting on the checkbox.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { flushSync } from 'svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
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
      org: null,
      allOrgs: [],
      transferCanDelete: false,
      canWriteMemory: true,
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
 * A real sibling save: the Memory card's superforms handlers run against a
 * successful result, then kit invalidates all loaders — fresh graph and a
 * fresh six-form set replace `data`, and the sibling's result becomes the
 * page's action data.
 */
async function siblingSave(m: { target: HTMLElement; props: Record<string, unknown> }, refreshedGraph: Memory) {
  // The repro's exact gesture: the Memory card form exists only in Edit mode.
  const edit = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit')!;
  edit.click();
  flushSync();
  const outcome = await memoryOutcome();
  const sent = await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>(MEMORY)!, outcome);
  expect(sent.cancelled).toBe(false);
  const forms = await settingsForms(refreshedGraph);
  m.props.data = { ...(m.props.data as Record<string, unknown>), graph: refreshedGraph, ...forms };
  page.update((p) => ({ ...p, data: m.props.data as Record<string, unknown> }));
  m.props.form = outcome.data;
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
  // persisted flag, the toggle reseeds to the server's answer, never the
  // local intent.
  it('reseeds when the persisted flag changed behind the sibling save', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: false }));
    mounted.push(m);
    setBox(m.target, true);
    await siblingSave(m, settingsGraph({ visibility: 'PUBLIC', listedOnMarketplace: true }));
    expect(cardBox(m.target).checked).toBe(true);
    setBox(m.target, false);
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
