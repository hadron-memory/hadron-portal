import { afterEach, expect, it } from 'vitest';
import AgentExtendedBy from './AgentExtendedBy.svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
async function show(result: { items: Array<{ id: string; name: string; urn: string }>; hasMore: boolean; endCursor: string | null; failed: boolean }) {
  setStubPage('http://localhost/app/agents/base');
  const m = mountComponent(AgentExtendedBy, { agentId: 'base', result }); mounted.push(m); await tick(5); return m.target;
}
it('shows readable names and linked URNs in the shared table and safely encodes continuation', async () => {
  const target = await show({ items: [{ id: 'child', name: 'Child', urn: 'hrn:agent:example.com:child' }], hasMore: true, endCursor: 'opaque+/=', failed: false });
  expect(target.querySelector('table')).not.toBeNull();
  expect(target.querySelector('a[href="/app/agents/child"]')?.textContent).toBe('Child');
  expect(target.querySelector('a[href="/app/u/hrn:agent:example.com:child"]')).not.toBeNull();
  expect(target.querySelector('a[href*="extendedAfter="]')?.getAttribute('href')).toBe('/app/agents/base?extendedAfter=opaque%2B%2F%3D');
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
  expect(target.querySelector('a[href="/app/agents/base"]')).not.toBeNull();
});
it('shows a completed empty page without a continuation', async () => {
  const target = await show({ items: [], hasMore: false, endCursor: null, failed: false });
  expect(target.textContent).toContain('No readable extending Agents on this page');
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
