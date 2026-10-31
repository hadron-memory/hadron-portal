import { afterEach, describe, expect, it } from 'vitest';
import AgentExtendedBy from './AgentExtendedBy.svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, navigationHooks, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { setStubPage } from '$lib/test/stubs/app-stores';
const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); resetNavigationCalls(); });
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
  expect(links[0].getAttribute('href')).toBe('/app/agents/base?extendedAfter=opaque%2B%2F%3D');
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

it.each([null, 'opaque+/='])('Retry actually re-fetches the current failed page and restores section focus (%s)', async (after) => {
  const target = await show({ ...empty, failed: true }, after);
  let finish!: () => void;
  navigationHooks.onInvalidateAll = () => new Promise<void>(resolve => { finish = resolve; });
  const retry = [...target.querySelectorAll<HTMLAnchorElement>('nav a')].find(a => a.textContent === 'Retry')!;
  retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(2);
  expect(navigationCalls.filter(c => c.fn === 'invalidateAll')).toHaveLength(1);
  retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(navigationCalls.filter(c => c.fn === 'invalidateAll')).toHaveLength(1);
  finish(); await tick(5);
  expect(document.activeElement).toBe(target.querySelector('#extended-by'));
});
it('first-page failure copy only offers the Retry action that is present', async () => {
  const target = await show({ ...empty, failed: true });
  expect(target.querySelector('[role=alert]')?.textContent).toBe('Could not load extending Agents. Retry this page.');
  expect(target.textContent).not.toContain('return to the first page');
});

it('a completed Retry does not move focus after its section unmounts', async () => {
  const target = await show({ ...empty, failed: true });
  let finish!: () => void;
  navigationHooks.onInvalidateAll = () => new Promise<void>(resolve => { finish = resolve; });
  target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(2);
  mounted[mounted.length - 1].unmount();
  const other = document.createElement('input'); document.body.append(other); other.focus();
  try { finish(); await tick(5); expect(document.activeElement).toBe(other); }
  finally { other.remove(); }
});

it('keeps search when a parent replaces its loader Agent object with the same identity, including Retry', async () => {
  setStubPage('http://localhost/app/agents/base');
  const loader = reactiveProps({ agent: { id: 'base' }, after: null as string | null, result: { ...empty, failed: true } });
  // Match Svelte's parent-generated prop getter, which reads the refreshed object.
  const props = {
    get agentId() { return loader.agent.id; },
    get requestedAfter() { return loader.after; },
    get result() { return loader.result; },
  };
  const m = mountComponent(AgentExtendedBy, props); mounted.push(m); await tick(5);
  const search = m.target.querySelector<HTMLInputElement>('input[aria-label="Search extending Agents on this page"]')!;
  search.value = 'Ext 1'; search.dispatchEvent(new Event('input', { bubbles: true })); await tick(5);
  loader.agent = { id: 'base' }; loader.result = { ...loader.result }; await tick(5);
  expect(search.value).toBe('Ext 1');
  navigationHooks.onInvalidateAll = () => { loader.agent = { id: 'base' }; loader.result = { ...loader.result }; };
  m.target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(5);
  expect(search.value).toBe('Ext 1');
  loader.after = 'next'; await tick(5);
  expect(search.value).toBe('');
  search.value = 'Ext 1'; search.dispatchEvent(new Event('input', { bubbles: true })); await tick(5);
  loader.agent = { id: 'different' }; await tick(5);
  expect(search.value).toBe('');
});

// #1312: the in-page handler owns only a plain primary activation. Browser
// middle clicks use auxclick; a synthetic click also pins the handler guard.
it.each([
  ['Ctrl', { ctrlKey: true }],
  ['Cmd', { metaKey: true }],
  ['Shift', { shiftKey: true }],
  ['Alt', { altKey: true }],
  ['middle click', { button: 1 }],
  ['secondary click', { button: 2 }],
] as const)('Retry preserves native %s activation without invalidating or taking focus', async (_label, init) => {
  const target = await show({ ...empty, failed: true }, 'opaque+/=');
  const retry = target.querySelector<HTMLAnchorElement>('nav a')!;
  retry.focus();
  const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...init });
  retry.dispatchEvent(event);
  await tick(2);
  expect(event.defaultPrevented).toBe(false);
  expect(navigationCalls.filter(c => c.fn === 'invalidateAll')).toHaveLength(0);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute('href')).toBe('/app/agents/base?extendedAfter=opaque%2B%2F%3D');
  expect(retry.hasAttribute('data-sveltekit-reload')).toBe(true);
});
it('Retry leaves middle-button auxclick native without invalidation', async () => {
  const target = await show({ ...empty, failed: true });
  const event = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  target.querySelector<HTMLAnchorElement>('nav a')!.dispatchEvent(event);
  await tick(2);
  expect(event.defaultPrevented).toBe(false);
  expect(navigationCalls.filter(c => c.fn === 'invalidateAll')).toHaveLength(0);
});
it('Retry intercepts plain primary clicks and ignores modified activations during a pending retry', async () => {
  const target = await show({ ...empty, failed: true });
  let finish!: () => void;
  navigationHooks.onInvalidateAll = () => new Promise<void>(resolve => { finish = resolve; });
  const retry = target.querySelector<HTMLAnchorElement>('nav a')!;
  const plain = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
  retry.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(true);
  expect(navigationCalls.filter(c => c.fn === 'invalidateAll')).toHaveLength(1);
  const modified = new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true });
  retry.dispatchEvent(modified);
  expect(modified.defaultPrevented).toBe(false);
  expect(navigationCalls.filter(c => c.fn === 'invalidateAll')).toHaveLength(1);
  finish(); await tick(5);
});

// #1311: Retry gives a pending cue and makes a repeated identical failure
// perceivable again. Both regions are mounted before any retry so a screen
// reader has already seen them; the table is never remounted to refresh them.
// Node identity and text changes are DOM evidence, not a native announcement.
describe('Retry feedback (#1311)', () => {
  const FAILED = 'Could not load extending Agents. Retry this page.';
  const status = (root: HTMLElement) => root.querySelector<HTMLElement>('#extended-by-status');
  const alert = (root: HTMLElement) => root.querySelector<HTMLElement>('#extended-by-alert');
  const retryLink = (root: HTMLElement) => root.querySelector<HTMLAnchorElement>('nav a')!;
  async function mountLoader() {
    setStubPage('http://localhost/app/agents/base');
    const loader = reactiveProps({ result: { ...empty, failed: true } as typeof empty });
    const props = { agentId: 'base', requestedAfter: null, get result() { return loader.result; } };
    const m = mountComponent(AgentExtendedBy, props as never); mounted.push(m); await tick(5);
    return { root: m.target, loader };
  }
  function hold() {
    let finish!: () => void; let fail!: (e: unknown) => void;
    navigationHooks.onInvalidateAll = () => new Promise<void>((res, rej) => { finish = res; fail = rej; });
    return { finish: () => finish(), fail: (e: unknown) => fail(e) };
  }

  it('mounts an empty polite status and the failure alert before any retry', async () => {
    const { root } = await mountLoader();
    expect(status(root)?.getAttribute('role')).toBe('status');
    expect(status(root)?.textContent?.trim()).toBe('');
    expect(alert(root)?.getAttribute('role')).toBe('alert');
    expect(alert(root)?.textContent).toBe(FAILED);
  });

  it('shows and announces Retrying… while pending, without claiming no extending Agents', async () => {
    const { root } = await mountLoader();
    const before = { s: status(root), a: alert(root), table: root.querySelector('table') };
    hold();
    retryLink(root).click(); await tick(2);
    expect(retryLink(root).textContent).toBe('Retrying…');
    expect(retryLink(root).getAttribute('aria-disabled')).toBe('true');
    expect(status(root)).toBe(before.s);
    expect(status(root)!.textContent).toBe('Retrying…');
    expect(root.textContent).not.toMatch(/No (readable )?(extending )?Agents/);
    expect(root.querySelector('table')).toBe(before.table);
  });

  it.each([
    ['the reload settles still failed', (h: ReturnType<typeof hold>) => h.finish()],
    ['the reload itself rejects', (h: ReturnType<typeof hold>) => h.fail(new Error('route reload failed'))],
  ] as const)('re-announces an identical failure when %s, in the same alert node', async (_l, settle) => {
    const { root } = await mountLoader();
    const a = alert(root), s = status(root), table = root.querySelector('table');
    const h = hold();
    retryLink(root).click(); await tick(2);
    // Emptied while pending, so the same text arriving again is a change.
    expect(alert(root)).toBe(a);
    expect(a!.textContent?.trim()).toBe('');
    settle(h); await tick(5);
    expect(alert(root)).toBe(a);
    expect(a!.textContent).toBe(FAILED);
    expect(status(root)).toBe(s);
    expect(s!.textContent?.trim()).toBe('');
    expect(retryLink(root).textContent).toBe('Retry');
    expect(root.querySelector('table')).toBe(table);
    expect(document.activeElement).toBe(root.querySelector('#extended-by'));
  });

  it('clears pending on success and announces no failure', async () => {
    const { root, loader } = await mountLoader();
    const a = alert(root), s = status(root);
    navigationHooks.onInvalidateAll = () => { loader.result = { items: [{ id: 'c', name: 'Child', urn: 'hrn:agent:example.com:c' }] as never, hasMore: false, endCursor: null, failed: false }; };
    retryLink(root).click(); await tick(5);
    expect(alert(root)).toBe(a);
    expect(a!.textContent?.trim()).toBe('');
    expect(status(root)).toBe(s);
    expect(s!.textContent?.trim()).toBe('');
    expect(root.querySelector('a[href="/app/agents/c"]')?.textContent).toBe('Child');
  });
});
