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

  // #1465 (Gabriel on #1460): the scan is slow and this component is reused on a [id] navigation.
  // A's result arriving after the reader moved to B must not be applied as B's page data.
  it("A's late result is not applied after navigating to B (#1465)", async () => {
    const applied: unknown[] = [];
    const { target, props } = await mountOn('mem-A');
    const a = await submitEnhancedDeferred(formOf(target), { update: async (o) => { applied.push(o); } });
    props.data = await dataFor('mem-B');
    await settle();
    await a.finish(OK);
    await settle();
    expect(applied).toEqual([]);
  });

  it('control: a result for the memory still on screen is applied (#1465)', async () => {
    const applied: unknown[] = [];
    const { target } = await mountOn('mem-A');
    const a = await submitEnhancedDeferred(formOf(target), { update: async (o) => { applied.push(o); } });
    await a.finish(OK);
    await settle();
    expect(applied).toHaveLength(1);
  });

  // #1465 delta (Andi, LOCAL P2): the memory id alone is not enough. A1 -> B -> A -> A2: A1 lands while the
  // page is on A again, but A2 is the scan that belongs on screen.
  it("A1, B, back to A and A2: A1's late result is not applied, A2's is (#1465)", async () => {
    const applied: string[] = [];
    const { target, props } = await mountOn('mem-A');
    const a1 = await submitEnhancedDeferred(formOf(target), { update: async () => { applied.push('A1'); } });
    props.data = await dataFor('mem-B');
    await settle();
    props.data = await dataFor('mem-A');
    await settle();
    const a2 = await submitEnhancedDeferred(formOf(target), { update: async () => { applied.push('A2'); } });
    await a1.finish(OK);
    await settle();
    expect(applied).toEqual([]);
    await a2.finish(OK);
    await settle();
    expect(applied).toEqual(['A2']);
  });
});

describe('vector health: the all-clear note (portal#2378)', () => {
  it('is announced by a region that exists, empty, before the check has run, and is the same element after', async () => {
    const { target, props } = await mountOn('mem-A');
    const region = () => target.querySelector<HTMLElement>('[data-testid="vector-health-region"]');
    const before = region();
    expect(before, 'mounted before any check').not.toBeNull();
    expect(before!.getAttribute('role')).toBe('status');
    expect(before!.textContent?.trim()).toBe('');
    props.form = { vectorHealth: { failed: [], truncation: null, skipped: null, nodesChecked: 12 } } as never;
    await settle();
    expect(region()).toBe(before);
    expect(before!.textContent).toContain('No failed embeddings among the findings returned.');
  });
});
