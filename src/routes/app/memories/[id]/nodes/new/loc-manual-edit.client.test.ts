/** #1477: a manually edited New-node Loc is not reverted to the Name slug. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { createNodeSchema } from './schema';


const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountPage(prefillLoc = '') {
  const form = await superValidate({}, zod4(createNodeSchema), { errors: false });
  const m = mountComponent(Page as never, {
    data: {
      graph: { id: 'm1', name: 'Test memory', urn: 'hrn:mem:acme:docs', schema: null },
      org: null, parentLoc: null, existingLocs: [], prefillLoc, form,
    },
    form: null,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}

// A real keystroke is dispatched from an empty JS stack, so the browser runs a
// microtask checkpoint after EACH listener: bind:value's own listener (which
// stores the new value) is followed by a flush of the effects it triggered
// BEFORE the root-delegated `oninput` runs. jsdom's synchronous dispatchEvent
// never drains between listeners, which is how this defect hid from the lane
// (#1477). Registering a flush listener after mount (so after bind:value's)
// reproduces the browser's ordering.
const withCheckpoint = new WeakSet<HTMLInputElement>();
function type(el: HTMLInputElement, value: string) {
  if (!withCheckpoint.has(el)) {
    el.addEventListener('input', () => flushSync());
    withCheckpoint.add(el);
  }
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

// Real-time settle: the repro reverts ~200 ms after the edit.
const settle = () => new Promise((r) => setTimeout(r, 300));

describe('New node — Loc manual edit (#1477)', () => {
  it('keeps a typed Loc after select-all + delete + typing', async () => {
    const t = await mountPage();
    const name = t.querySelector<HTMLInputElement>('#name')!;
    const loc = t.querySelector<HTMLInputElement>('#loc')!;
    type(name, 'Daily review');
    expect(loc.value).toBe('daily-review');
    type(loc, '');
    await settle();
    expect(loc.value).toBe('');
    type(loc, 'register:tick.daily-review');
    await settle();
    expect(loc.value).toBe('register:tick.daily-review');
  });

  it('leaves a manual Loc alone when the Name changes afterwards', async () => {
    const t = await mountPage();
    const name = t.querySelector<HTMLInputElement>('#name')!;
    const loc = t.querySelector<HTMLInputElement>('#loc')!;
    type(name, 'Daily review');
    type(loc, 'mine');
    type(name, 'Daily review two');
    await settle();
    expect(loc.value).toBe('mine');
  });

  it('still derives Loc from Name when Loc was never touched (#624)', async () => {
    const t = await mountPage();
    type(t.querySelector<HTMLInputElement>('#name')!, 'Sort imports');
    await settle();
    expect(t.querySelector<HTMLInputElement>('#loc')!.value).toBe('sort-imports');
  });

  it('keeps a prefilled Loc when the Name is typed', async () => {
    const t = await mountPage('a:b');
    type(t.querySelector<HTMLInputElement>('#name')!, 'Sort imports');
    await settle();
    expect(t.querySelector<HTMLInputElement>('#loc')!.value).not.toBe('sort-imports');
  });
});
