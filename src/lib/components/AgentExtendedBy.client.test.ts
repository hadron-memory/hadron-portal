import { afterEach, expect, it } from 'vitest';
import AgentExtendedBy from './AgentExtendedBy.svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
async function show(result: { items: Array<{ id: string; name: string; urn: string }>; hasMore: boolean; endCursor: string | null; failed: boolean }, requestedAfter: string | null = null) {
  setStubPage('http://localhost/app/agents/base');
  const m = mountComponent(AgentExtendedBy, { agentId: 'base', result, requestedAfter } as never); mounted.push(m); await tick(5); return m.target;
}
it('shows readable names and linked URNs in the shared table and safely encodes continuation', async () => {
  const target = await show({ items: [{ id: 'child', name: 'Child', urn: 'hrn:agent:example.com:child' }], hasMore: true, endCursor: 'opaque+/=', failed: false });
  expect(target.querySelector('table')).not.toBeNull();
  expect(target.querySelector('a[href="/app/agents/child"]')?.textContent).toBe('Child');
  expect(target.querySelector('a[href="/app/u/hrn:agent:example.com:child"]')).not.toBeNull();
  expect(target.querySelector('a[href*="extendedAfter="]')?.getAttribute('href')).toBe('/app/agents/base?extendedAfter=opaque%2B%2F%3D#extended-by');
});
it('offers continuation after an empty bounded scan and does not claim there are no extending agents', async () => {
  const target = await show({ items: [], hasMore: true, endCursor: 'next', failed: false });
  expect(target.textContent).toContain('Continue to check for more results');
  expect(target.querySelector('a[href*="extendedAfter="]')).not.toBeNull();
});
it('keeps an expired/refused read distinct from empty and offers first-page recovery', async () => {
  const target = await show({ items: [], hasMore: false, endCursor: null, failed: true });
  expect(target.querySelector('[role=alert]')).not.toBeNull();
  expect(target.textContent).not.toContain('No readable extending Agents');
  expect(target.querySelector('nav a')?.textContent).toBe('Retry');
});
it('shows a completed empty page without a continuation', async () => {
  const target = await show({ items: [], hasMore: false, endCursor: null, failed: false });
  expect(target.textContent).toContain('No Agents you can read extend this Agent');
  expect(target.querySelector('a[href*="extendedAfter="]')).toBeNull();
});

it('resets local row position on replacement server pages and keeps empty-grid controls mounted', async () => {
  setStubPage('http://localhost/app/agents/base');
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `child-${i}`, name: `Child ${i}`, urn: `hrn:agent:example.com:child-${i}` }));
  const props = reactiveProps({ agentId: 'base', result: { items: rows, hasMore: true, endCursor: 'next' as string | null, failed: false } });
  const m = mountComponent(AgentExtendedBy, props); mounted.push(m); await tick(5);
  const size = m.target.querySelector('select[aria-label="Rows per page"]') as HTMLSelectElement;
  size.value = '10'; size.dispatchEvent(new Event('change', { bubbles: true })); await tick(5);
  [...m.target.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Next')!.click(); await tick(5);
  expect(m.target.querySelector('a[href="/app/agents/child-0"]')).toBeNull();
  props.result = { items: [], hasMore: true, endCursor: 'another', failed: false };
  await tick(5);
  expect(m.target.querySelector('table')).not.toBeNull();
  expect(m.target.textContent).toContain('Continue to check for more results');
  props.result = { items: [rows[0]], hasMore: false, endCursor: null, failed: false };
  await tick(5);
  expect(m.target.querySelector('a[href="/app/agents/child-0"]')).not.toBeNull();
});

const empty = { items: [], hasMore: false, endCursor: null, failed: false };
it('labels the anchored section by its visible heading and names the 20-row server continuation', async () => {
  const target = await show({ ...empty, hasMore: true, endCursor: 'next' });
  const section = target.querySelector('section')!;
  expect(section.id).toBe('extended-by');
  expect(section.hasAttribute('aria-label')).toBe(false);
  expect(section.getAttribute('aria-labelledby')).toBe(target.querySelector('h2')!.id);
  expect(target.querySelector('a[href*="extendedAfter="]')?.textContent).toBe('Next 20 extending Agents');
  expect(target.textContent).not.toContain('First page');
});
it('offers Retry of the failed opaque later page plus first-page recovery', async () => {
  const target = await show({ ...empty, failed: true }, 'opaque+/=');
  const links = [...target.querySelectorAll('nav a')];
  expect(links.map(a => a.textContent)).toEqual(['Retry', 'First page']);
  expect(links[0].getAttribute('href')).toBe('/app/agents/base?extendedAfter=opaque%2B%2F%3D#extended-by');
  expect(links[1].getAttribute('href')).toBe('/app/agents/base#extended-by');
});
it('keeps completed first-empty, later-final-empty and incomplete empty scans distinct', async () => {
  const first = await show(empty);
  expect(first.textContent).toContain('No Agents you can read extend this Agent');
  expect(first.querySelector('nav a')).toBeNull();
  const later = await show(empty, 'previous');
  expect(later.textContent).toContain('No readable extending Agents on this page');
  expect(later.textContent).not.toContain('No Agents you can read extend this Agent');
  expect(later.querySelector('nav a')?.textContent).toBe('First page');
  const more = await show({ ...empty, hasMore: true, endCursor: 'next' }, 'previous');
  expect(more.textContent).toContain('Continue to check for more results');
  expect(more.querySelector('a[href*="extendedAfter="]')).not.toBeNull();
});
it('resets search and local row position only across Agent/requested-page identity, keeping saved grid controls', async () => {
  setStubPage('http://localhost/app/agents/base');
  const rows = Array.from({ length: 20 }, (_, i) => ({ id: `row-${i}`, name: `Child ${i}`, urn: `hrn:agent:example.com:row-${i}` }));
  const props = reactiveProps({ agentId: 'base', requestedAfter: null as string | null, result: { ...empty, items: rows } });
  const m = mountComponent(AgentExtendedBy, props); mounted.push(m); await tick(5);
  const search = () => m.target.querySelector<HTMLInputElement>('input[aria-label="Search extending Agents on this page"]')!;
  const type = async () => { search().value = 'Child'; search().dispatchEvent(new Event('input', { bubbles: true })); await tick(5); };
  const size = m.target.querySelector<HTMLSelectElement>('select[aria-label="Rows per page"]')!;
  size.value = '10'; size.dispatchEvent(new Event('change', { bubbles: true })); await tick(5);
  await type();
  props.result = { ...props.result, items: [...rows] }; await tick(5);
  expect(search().value).toBe('Child');
  [...m.target.querySelectorAll('button')].find(b => b.textContent?.trim() === 'Next')!.click(); await tick(5);
  expect(m.target.querySelector('a[href="/app/agents/row-0"]')).toBeNull();
  props.requestedAfter = 'next'; await tick(5);
  expect(search().value).toBe('');
  expect(m.target.querySelector('a[href="/app/agents/row-0"]')).not.toBeNull();
  expect(size.value).toBe('10');
  await type(); props.requestedAfter = 'failed-page'; props.result = { ...empty, failed: true }; await tick(5);
  expect(search().value).toBe('');
  await type(); props.requestedAfter = null; props.result = { ...empty, items: rows }; await tick(5);
  expect(search().value).toBe('');
  await type(); props.agentId = 'other'; await tick(5);
  expect(search().value).toBe('');
  expect(size.value).toBe('10');
});
