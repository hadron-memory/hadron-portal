import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import Page from './+page.svelte';
import { mountComponent } from '$lib/test/mountComponent';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';
import { grantsFixture } from './grants.fixture';
let mounted: ReturnType<typeof mountComponent> | undefined;
afterEach(() => { mounted?.unmount(); resetStubPage(); vi.unstubAllGlobals(); });
it('switches fields by action name and never presents an inherited object key as a picked node', () => {
  setStubPage('http://localhost/app/apps/app-example/grants', { appId: 'app-example' });
  mounted = mountComponent(Page, { data: { ...grantsFixture(), actionDefinitions: [
    { name: 'fifth', parameters: [{ name: '__proto__', type: 'node-ref', refusesWildcard: true }] },
    { name: 'sixth', parameters: [{ name: 'different', type: 'node-ref', refusesWildcard: true }] },
  ] } } as never);
  flushSync();
  const target = mounted.target;
  expect(target.querySelector<HTMLInputElement>('[name="parameter:__proto__"]')?.value).toBe('');
  const submit = target.querySelector<HTMLButtonElement>('form[action*="/create"] button:not([type="button"])')!;
  expect(submit.disabled).toBe(true);
  const select = target.querySelector<HTMLSelectElement>('#grant-action')!;
  select.value = 'sixth'; select.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
  expect(target.querySelector('[name="parameter:__proto__"]')).toBeNull();
  expect(target.querySelector('[name="parameter:different"]')).not.toBeNull();
  expect(submit.disabled).toBe(true);
});
it('uses the real SelectNode callback id in the named form field, retaining the URN only for display', async () => {
  setStubPage('http://localhost/app/apps/app-example/grants', { appId: 'app-example' });
  const choice = { id: 'stored-node-id', name: 'Chosen node', loc: 'chosen', urn: 'hrn:node:example.test:mem:chosen' };
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    expect(url).toContain('/nodes/choices?');
    return { ok: true, json: async () => ({ kind: "ok", value: { items: [choice], hasMore: false, nextOffset: 1 } }) };
  }));
  mounted = mountComponent(Page, { data: { ...grantsFixture(),
    memories: { kind: 'ok', value: [{ id: 'memory', name: 'Memory', urn: 'hrn:mem:example.test:mem' }] },
    actionDefinitions: [{ name: 'fifth', parameters: [{ name: 'differentNode', type: 'node-ref', refusesWildcard: true }] }],
  } } as never);
  flushSync();
  const target = mounted.target;
  target.querySelector<HTMLButtonElement>('[aria-label="Choose a node… differentNode"]')!.click(); flushSync();
  await vi.waitFor(() => expect(target.querySelector('[aria-label="Select Memory"]')).not.toBeNull());
  target.querySelector<HTMLButtonElement>('[aria-label="Select Memory"]')!.click(); flushSync();
  const search = [...target.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Find")!;
  search.click(); flushSync();
  await vi.waitFor(() => expect(target.querySelector('[aria-label="Select Chosen node"]')).not.toBeNull());
  target.querySelector<HTMLButtonElement>('[aria-label="Select Chosen node"]')!.click(); flushSync();
  expect(target.querySelector<HTMLInputElement>('[name="parameter:differentNode"]')?.value).toBe(choice.id);
  expect(target.querySelector('[title="' + choice.urn + '"]')).not.toBeNull();
});
