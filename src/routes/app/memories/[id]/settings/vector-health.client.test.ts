/**
 * portal#1346 (George on #1460) — the health scan is whole-memory and slow, and
 * this page component is reused on a [id] navigation. Its pending state must
 * belong to the memory that asked: A's scan must not keep B's button disabled,
 * and A's late completion must not clear B's own pending state.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };

async function dataFor(id: string) {
  const graph = settingsGraph({ id, vectorIndexEnabled: true });
  const f = await settingsForms(graph, true);
  return { graph, user: OWNER, ownerUserId: OWNER_ID, owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' }, org: null, allOrgs: [], transferCanDelete: false, ...f } as never;
}
async function mountOn(id: string) {
  const data = await dataFor(id);
  const props = reactiveProps<Record<string, unknown>>({ data, form: null as never });
  setStubPage(`http://localhost/app/memories/${id}/settings`, { id });
  page.update((p) => ({ ...p, data: data as Record<string, unknown> }));
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await settle();
  return { ...m, props };
}
const formOf = (t: HTMLElement) => t.querySelector<HTMLFormElement>('form[action="?/checkVectorIndexHealth"]')!;
const buttonOf = (t: HTMLElement) => formOf(t).querySelector<HTMLButtonElement>('button')!;
const OK = { type: 'success' as const, status: 200, data: {} };

describe('vector health pending state (#1346)', () => {
  it('control: the same memory is disabled while pending and enabled when done', async () => {
    const { target } = await mountOn('mem-A');
    expect(buttonOf(target).disabled).toBe(false);
    const a = await submitEnhancedDeferred(formOf(target));
    await settle();
    expect(buttonOf(target).disabled).toBe(true);
    await a.finish(OK);
    await settle();
    expect(buttonOf(target).disabled).toBe(false);
  });

  it("A's pending scan does not disable B's button after navigation", async () => {
    const { target, props } = await mountOn('mem-A');
    await submitEnhancedDeferred(formOf(target));
    props.data = await dataFor('mem-B');
    await settle();
    expect(buttonOf(target).disabled).toBe(false);
  });

  it("A's late completion does not clear B's own pending state", async () => {
    const { target, props } = await mountOn('mem-A');
    const a = await submitEnhancedDeferred(formOf(target));
    props.data = await dataFor('mem-B');
    await settle();
    await submitEnhancedDeferred(formOf(target));
    await settle();
    expect(buttonOf(target).disabled).toBe(true);
    await a.finish(OK);
    await settle();
    expect(buttonOf(target).disabled).toBe(true);
  });

  it("A1, B1, back to A and A2: A1's late completion does not clear A2", async () => {
    const { target, props } = await mountOn('mem-A');
    const a1 = await submitEnhancedDeferred(formOf(target));
    props.data = await dataFor('mem-B');
    await settle();
    await submitEnhancedDeferred(formOf(target));
    props.data = await dataFor('mem-A');
    await settle();
    await submitEnhancedDeferred(formOf(target));
    await settle();
    expect(buttonOf(target).disabled).toBe(true);
    await a1.finish(OK);
    await settle();
    expect(buttonOf(target).disabled).toBe(true);
  });
});
