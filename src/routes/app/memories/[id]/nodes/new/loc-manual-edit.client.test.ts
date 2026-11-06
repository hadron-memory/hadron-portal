/** #1477: a manually edited New-node Loc is not reverted to the Name slug. */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Page from './+page.svelte';
import { createNodeSchema } from './schema';


const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

/**
 * `failedSubmit` is what the action returns when a submit is refused: the form
 * the user posted, handed back as `form.form` (#1481). It is the one way the page
 * mounts with a Loc the user already chose that is NOT a deep-link prefill.
 */
async function mountPage(prefillLoc = '', failedSubmit?: { name: string; loc: string }) {
  // The loader seeds the form with the deep-link Loc (+page.server.ts: `superValidate({ loc: prefillLoc })`).
  const form = await superValidate({ loc: prefillLoc }, zod4(createNodeSchema), { errors: false });
  const posted = failedSubmit ? await superValidate(failedSubmit, zod4(createNodeSchema), { errors: false }) : null;
  const m = mountComponent(Page as never, {
    data: {
      graph: { id: 'm1', name: 'Test memory', urn: 'hrn:mem:acme:docs', schema: null },
      org: null, parentLoc: null, existingLocs: [], prefillLoc, form,
    },
    form: posted ? { form: posted } : null,
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

// Settle by draining the microtask queue and the effects it schedules (#1481): the
// derive effect that reverted the Loc is microtask-driven, so no wall-clock wait is
// needed, and a fixed delay only made the lane slower and, on a loaded runner, flaky.
const settle = () => tick(5);

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
    expect(t.querySelector<HTMLInputElement>('#loc')!.value).toBe('a:b');
  });

  // #1481: after a refused submit the page remounts with the form the user
  // posted, and its Loc is theirs, not a slug to recompute from the Name.
  it('keeps the Loc of a failed submit when the Name is edited', async () => {
    const t = await mountPage('', { name: 'Daily review', loc: 'register:tick.mine' });
    const name = t.querySelector<HTMLInputElement>('#name')!;
    const loc = t.querySelector<HTMLInputElement>('#loc')!;
    expect(loc.value).toBe('register:tick.mine');
    type(name, 'Daily review two');
    await settle();
    expect(loc.value).toBe('register:tick.mine');
  });

  it('keeps an emptied Loc of a failed submit empty when the Name is edited', async () => {
    const t = await mountPage('', { name: 'Daily review', loc: '' });
    const loc = t.querySelector<HTMLInputElement>('#loc')!;
    type(t.querySelector<HTMLInputElement>('#name')!, 'Daily review two');
    await settle();
    expect(loc.value).toBe('');
  });

  it('a fresh page with no failed submit still derives Loc from Name (the failed-submit arm is not always on)', async () => {
    const t = await mountPage();
    type(t.querySelector<HTMLInputElement>('#name')!, 'Daily review');
    await settle();
    expect(t.querySelector<HTMLInputElement>('#loc')!.value).toBe('daily-review');
  });
});
