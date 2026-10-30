import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { page, resetStubPage } from '$lib/test/stubs/app-stores';
import Harness from '$lib/test/fixtures/property-filter-outlet-harness.svelte';
let m: Mounted<Record<string, never>> | undefined;
afterEach(() => { m?.unmount(); resetStubPage(); vi.unstubAllGlobals(); });
function route(id: string) { page.update(p => ({ ...p, route: { id }, url: new URL('http://localhost'+id.replace('(browser)/', '').replace('[id]', 'mem-a')) })); flushSync(); }
function open() { [...m!.target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim().startsWith('Properties'))!.click(); flushSync(); }
it('keeps the applied property filter across Nodes→Graph→Nodes, but tears down for another route', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nodes: [], total: 0 }))));
  route('/app/memories/[id]/(browser)/nodes');
  m = mountComponent(Harness, {}); open();
  function pick(selector: string, value: string) {
    const el = m!.target.querySelector<HTMLSelectElement>(selector)!; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
  }
  pick('#structured-object-type', 'task');
  pick('[data-testid="property-filter-field"]', 'enabled');
  pick('[data-testid="property-filter-value"]', 'false');
  [...m.target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Apply filter')!.click(); flushSync();
  for (const tab of ['graph', 'nodes']) {
    route('/app/memories/[id]/(browser)/'+tab);
    if (!m.target.querySelector('#structured-object-type')) open();
    expect((m.target.querySelector('#structured-object-type') as HTMLSelectElement | null)?.value).toBe('task');
    expect((m.target.querySelector('[data-testid="property-filter-value"]') as HTMLSelectElement | null)?.value).toBe('false');
  }
  route('/app/account/api-keys'); open();
  expect((m.target.querySelector('#structured-object-type') as HTMLSelectElement).value).toBe('');
});

// The Nodes/Graph exception to the route-keyed teardown is for that pair only:
// a sibling route in the SAME memory is still a different page and must not
// inherit an applied property filter.
it.each(['/app/memories/[id]/settings', '/app/memories/[id]/nodes/[nodeId]'])('tears down the applied property filter when leaving Nodes for %s of the same memory', (target) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nodes: [], total: 0 }))));
  route('/app/memories/[id]/(browser)/nodes');
  m = mountComponent(Harness, {}); open();
  const select = (selector: string, value: string) => {
    const el = m!.target.querySelector<HTMLSelectElement>(selector)!; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
  };
  select('#structured-object-type', 'task');
  select('[data-testid="property-filter-field"]', 'enabled');
  select('[data-testid="property-filter-value"]', 'false');
  [...m.target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Apply filter')!.click(); flushSync();
  expect((m.target.querySelector('#structured-object-type') as HTMLSelectElement).value).toBe('task');
  route(target); if (!m.target.querySelector('#structured-object-type')) open();
  expect((m.target.querySelector('#structured-object-type') as HTMLSelectElement | null)?.value).toBe('');
});
