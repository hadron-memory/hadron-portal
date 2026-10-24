import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import MemoryBrowser from './MemoryBrowser.svelte';

const schema = { objectTypes: {
  task: { fields: { status: { type: 'enum', values: ['draft', 'live'] }, count: { type: 'number' }, enabled: { type: 'boolean' } } },
  other: { fields: { status: { type: 'text' } } },
} };
const mounted: Array<Mounted<Record<string, unknown>>> = [];
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ nodes: [], total: 0 }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.useRealTimers(); vi.unstubAllGlobals();
});
function browser() {
  const props = reactiveProps<Record<string, unknown>>({ nodes: [], basePath: '/app/memories/mem-a', memory: { id: 'mem-a', schema }, forcedView: 'nodes' });
  const m = mountComponent(MemoryBrowser as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  [...m.target.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim().startsWith('Properties'))!.click();
  flushSync();
  return { ...m, props };
}
function pick(t: HTMLElement, selector: string, value: string) {
  const el = t.querySelector<HTMLSelectElement | HTMLInputElement>(selector);
  expect(el, selector).not.toBeNull();
  el!.value = value; el!.dispatchEvent(new Event(el!.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); flushSync();
}
function click(t: HTMLElement, label: string) {
  const b = [...t.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label);
  expect(b, label).toBeTruthy(); b!.click(); flushSync();
}
async function bodies() {
  await vi.advanceTimersByTimeAsync(400); await tick();
  return fetchMock.mock.calls.filter(([url]) => url === '/api/nodes/search').map(([, init]) => JSON.parse((init as RequestInit).body as string));
}
function filter(t: HTMLElement) {
  pick(t, '#structured-object-type', 'task');
  pick(t, '[data-testid="property-filter-field"]', 'enabled');
  pick(t, '[data-testid="property-filter-value"]', 'false');
  click(t, 'Apply filter');
}

describe('#1221 MemoryBrowser typed filters', () => {
  it('sends typed false using the same server filter channel', async () => {
    const { target } = browser(); filter(target);
    const calls = await bodies();
    expect(calls.at(-1).filter).toMatchObject({ objectType: 'task', where: { path: ['enabled'], as: 'boolean', eq: false } });
  });
  it('collection change clears applied predicate and stale draft values', async () => {
    const { target } = browser(); filter(target); await bodies();
    pick(target, '#structured-object-type', 'other');
    const calls = await bodies();
    expect(calls.at(-1).filter).toMatchObject({ objectType: 'other', where: null });
    expect((target.querySelector('[data-testid="property-filter-field"]') as HTMLSelectElement).value).toBe('');
  });
  it('memory navigation clears schema-scoped selection before querying the new memory', async () => {
    const { target, props } = browser(); filter(target); await bodies();
    props.basePath = '/app/memories/mem-b'; props.memory = { id: 'mem-b', schema }; flushSync();
    await bodies();
    const forB = (await bodies()).filter(b => b.memoryIds.includes('mem-b'));
    expect(forB.every(b => b.filter.where === null && b.filter.objectType === null)).toBe(true);
    expect((target.querySelector('#structured-object-type') as HTMLSelectElement).value).toBe('');
  });
});
