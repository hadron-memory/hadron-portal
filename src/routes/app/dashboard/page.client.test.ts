import { afterEach, expect, it } from 'vitest';
import Page from './+page.svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';

const placements = [
  { id: 'memory', type: 'memory-stats', span: 4, rowSpan: 1 },
  { id: 'activity', type: 'usage-activity', span: 6, rowSpan: 2 },
];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
async function show(data: Record<string, unknown>) {
  setStubPage('http://localhost/app/dashboard');
  const props = reactiveProps<Record<string, unknown>>({ data, form: null });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(5);
  return { ...m, props };
}
it('renders the shell before layout or widget data, without inventing zero counts', async () => {
  const layout = deferred<unknown>();
  const widgets = deferred<unknown>();
  const { target } = await show({ dashboard: layout.promise, widgetData: widgets.promise });
  expect(target.querySelector('h1')?.textContent).toContain('Dashboard');
  expect(target.textContent).toContain('Loading dashboard');
  expect(target.querySelector('[aria-label="Customize dashboard"]')).toBeNull();
  expect(target.textContent).toContain('Loading widget');
  expect(target.querySelector('.tabular-nums')).toBeNull();
});
it('keeps the saved widget layout loading, then shows a successful widget beside a failed one', async () => {
  const widgets = deferred<unknown>();
  const { target } = await show({ dashboard: Promise.resolve({ placements, loadFailed: false }), widgetData: widgets.promise });
  expect(target.textContent).toContain('Memory Stats');
  expect(target.textContent).toContain('Usage Activity');
  expect(target.querySelectorAll('[aria-busy=true]')).toHaveLength(2);
  expect(target.querySelector('[aria-label="Customize dashboard"]')).toBeNull();
  widgets.resolve({ data: { memory: { memoryCount: 7 } }, loadFailed: false });
  await tick(5);
  expect(target.querySelector('.tabular-nums')?.textContent).toBe('7');
  expect(target.querySelectorAll('[role=alert]')).toHaveLength(1);
  expect(target.textContent).toContain('Could not load this widget');
  expect(target.querySelector('[aria-busy=true]')).toBeNull();
});
it('renders a failed data read per widget and never falls back to zero', async () => {
  const { target } = await show({ dashboard: Promise.resolve({ placements, loadFailed: false }), widgetData: Promise.resolve({ data: {}, loadFailed: true }) });
  expect(target.querySelectorAll('[role=alert]')).toHaveLength(2);
  expect(target.querySelector('.tabular-nums')).toBeNull();
  expect(target.querySelector('[aria-label="Customize dashboard"]')).toBeNull();
});
it('reports layout failure within the already-rendered shell', async () => {
  const { target } = await show({ dashboard: Promise.resolve({ placements: [], loadFailed: true }), widgetData: Promise.resolve({ data: {}, loadFailed: false }) });
  expect(target.querySelector('h1')).not.toBeNull();
  expect(target.querySelector('[role=alert]')?.textContent).toContain('layout');
});
it('ignores a late widget answer from an earlier load', async () => {
  const old = deferred<unknown>();
  const dashboard = Promise.resolve({ placements: [placements[0]], loadFailed: false });
  const { target, props } = await show({ dashboard, widgetData: old.promise });
  props.data = { dashboard, widgetData: Promise.resolve({ data: { memory: { memoryCount: 12 } }, loadFailed: false }) };
  await tick(5);
  old.resolve({ data: { memory: { memoryCount: 999 } }, loadFailed: false });
  await tick(5);
  expect(target.querySelector('.tabular-nums')?.textContent).toBe('12');
});
it('does not render a departed load into a remounted Dashboard', async () => {
  const old = deferred<unknown>();
  const dashboard = Promise.resolve({ placements: [placements[0]], loadFailed: false });
  const first = await show({ dashboard, widgetData: old.promise });
  first.unmount();
  const next = await show({ dashboard, widgetData: Promise.resolve({ data: { memory: { memoryCount: 42 } }, loadFailed: false }) });
  old.resolve({ data: { memory: { memoryCount: 999 } }, loadFailed: false });
  await tick(5);
  expect(first.target.isConnected).toBe(false);
  expect(first.target.textContent).not.toContain('999');
  expect(next.target.querySelector('.tabular-nums')?.textContent).toBe('42');
});
