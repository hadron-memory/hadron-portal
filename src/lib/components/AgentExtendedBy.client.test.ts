import { afterEach, describe, expect, it, vi } from 'vitest';
import AgentExtendedBy from './AgentExtendedBy.svelte';
import { captureUnhandledRejections, mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { RETRY_TIMEOUT_MS } from '$lib/agent-extensions';
const mounted: Mounted<any>[] = [];
// #1503: Retry re-reads the section's own endpoint instead of invalidating the
// route, so the stub surface is fetch, not $app/navigation.
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);
const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as Response;
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); resetNavigationCalls(); fetchMock.mockReset(); });
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

it.each([null, 'opaque+/='])('Retry re-reads the section endpoint for the failed page exactly once and restores section focus (%s)', async (after) => {
  const target = await show({ ...empty, failed: true }, after);
  let finish!: (body: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = body => resolve(ok(body)); }));
  const retry = [...target.querySelectorAll<HTMLAnchorElement>('nav a')].find(a => a.textContent === 'Retry')!;
  retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  await tick(2);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe(after === null ? '/app/agents/base/extended-by' : '/app/agents/base/extended-by?after=opaque%2B%2F%3D');
  retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  finish({ ...empty, failed: false }); await tick(5);
  expect(document.activeElement).toBe(target.querySelector('#extended-by'));
});
it('first-page failure copy only offers the Retry action that is present', async () => {
  const target = await show({ ...empty, failed: true });
  expect(target.querySelector('[role=alert]')?.textContent).toBe('Could not load extending Agents. Retry this page.');
  expect(target.textContent).not.toContain('return to the first page');
});

it('a completed Retry does not move focus after its section unmounts', async () => {
  const target = await show({ ...empty, failed: true });
  let finish!: (body: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = body => resolve(ok(body)); }));
  target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(2);
  mounted[mounted.length - 1].unmount();
  const other = document.createElement('input'); document.body.append(other); other.focus();
  try { finish({ ...empty, failed: false }); await tick(5); expect(document.activeElement).toBe(other); }
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
  // #1503: a local Retry swap must not reset the filter either — only a page
  // identity change may.
  let succeed!: (body: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { succeed = body => resolve(ok(body)); }));
  m.target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(2);
  succeed({ items: [{ id: 'c', name: 'Ext 1 child', urn: 'hrn:agent:example.com:c' }], hasMore: false, endCursor: null, failed: false }); await tick(5);
  expect(search.value).toBe('Ext 1');
  expect(m.target.querySelector('a[href="/app/agents/c"]')?.textContent).toBe('Ext 1 child');
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
  expect(fetchMock).not.toHaveBeenCalled();
  expect(navigationCalls).toHaveLength(0);
  expect(document.activeElement).toBe(retry);
  expect(retry.getAttribute('href')).toBe('/app/agents/base?extendedAfter=opaque%2B%2F%3D');
  expect(retry.hasAttribute('data-sveltekit-reload')).toBe(true);
});
it('Retry leaves middle-button auxclick native without a section read', async () => {
  const target = await show({ ...empty, failed: true });
  const event = new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true });
  target.querySelector<HTMLAnchorElement>('nav a')!.dispatchEvent(event);
  await tick(2);
  expect(event.defaultPrevented).toBe(false);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(navigationCalls).toHaveLength(0);
});
it('Retry intercepts plain primary clicks and ignores modified activations during a pending retry', async () => {
  const target = await show({ ...empty, failed: true });
  let finish!: (body: unknown) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = body => resolve(ok(body)); }));
  const retry = target.querySelector<HTMLAnchorElement>('nav a')!;
  const plain = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
  retry.dispatchEvent(plain);
  expect(plain.defaultPrevented).toBe(true);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const modified = new MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true });
  retry.dispatchEvent(modified);
  expect(modified.defaultPrevented).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  finish({ ...empty, failed: true }); await tick(5);
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
    let finish!: (body: unknown) => void; let fail!: (e: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((res, rej) => { finish = body => res(ok(body)); fail = e => rej(e); }));
    return { finish: () => finish({ ...empty, failed: true }), succeed: (body: unknown) => finish(body), fail: (e: unknown) => fail(e) };
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
    ['the re-read settles still failed', (h: ReturnType<typeof hold>) => h.finish()],
    ['the re-read itself rejects', (h: ReturnType<typeof hold>) => h.fail(new Error('route reload failed'))],
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
    const { root } = await mountLoader();
    const a = alert(root), s = status(root);
    const h = hold();
    retryLink(root).click(); await tick(2);
    h.succeed({ items: [{ id: 'c', name: 'Child', urn: 'hrn:agent:example.com:c' }], hasMore: false, endCursor: null, failed: false }); await tick(5);
    expect(alert(root)).toBe(a);
    expect(a!.textContent?.trim()).toBe('');
    expect(status(root)).toBe(s);
    expect(s!.textContent?.trim()).toBe('');
    expect(root.querySelector('a[href="/app/agents/c"]')?.textContent).toBe('Child');
  });
});

// #1503: Retry re-reads only this section. A failed re-read must land inside
// the section — alert refilled, page in place, URL untouched — and never hand
// the failure to the router, which renders its error page over the Agent page
// (that is the whole reason invalidateAll is gone from this component).
describe('section-owned retry (#1503)', () => {
  const FAILED = 'Could not load extending Agents. Retry this page.';
  const retryLink = (root: HTMLElement) => root.querySelector<HTMLAnchorElement>('nav a')!;
  const alertEl = (root: HTMLElement) => root.querySelector<HTMLElement>('#extended-by-alert')!;

  it('keeps the page in place when the re-read is network-aborted, and re-announces the failure', async () => {
    const target = await show({ ...empty, failed: true });
    const a = alertEl(target);
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    retryLink(target).click(); await tick(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // No router call of any kind: that is what used to render the 500 page.
    expect(navigationCalls).toHaveLength(0);
    expect(alertEl(target)).toBe(a);
    expect(a.textContent).toBe(FAILED);
    expect(retryLink(target).textContent).toBe('Retry');
    expect(document.activeElement).toBe(target.querySelector('#extended-by'));
  });

  it.each([401, 500, 503])('treats an HTTP %s answer as a failed read, not a payload', async (status) => {
    const target = await show({ ...empty, failed: true });
    fetchMock.mockResolvedValueOnce({ ok: false, status, json: async () => ({}) } as Response);
    retryLink(target).click(); await tick(5);
    expect(alertEl(target).textContent).toBe(FAILED);
    expect(navigationCalls).toHaveLength(0);
  });

  it.each([
    ['null payload', null],
    ['items not an array', { items: 'nope', hasMore: false, endCursor: null, failed: true }],
    ['item without a urn', { items: [{ id: 'c', name: 'Child' }], hasMore: false, endCursor: null, failed: true }],
    ['item with a non-string id', { items: [{ id: 7, name: 'Child', urn: 'hrn:agent:example.com:c' }], hasMore: false, endCursor: null, failed: true }],
    ['hasMore not a boolean', { items: [], hasMore: 'yes', endCursor: null, failed: true }],
    ['endCursor neither string nor null', { items: [], hasMore: false, endCursor: 3, failed: true }],
    ['failed flag absent', { items: [], hasMore: false, endCursor: null }],
  ] as const)('refuses a malformed %s before rendering it', async (_label, body) => {
    const target = await show({ ...empty, failed: true });
    fetchMock.mockResolvedValueOnce(ok(body));
    retryLink(target).click(); await tick(5);
    expect(alertEl(target).textContent).toBe(FAILED);
    // No partial garbage reached the table: zero row links.
    expect(target.querySelector('table')?.querySelectorAll('a')).toHaveLength(0);
    expect(navigationCalls).toHaveLength(0);
  });

  it('swaps the section view on success: alert clears, Retry withdraws, continuation is offered', async () => {
    const target = await show({ ...empty, failed: true }, 'previous');
    fetchMock.mockResolvedValueOnce(ok({ items: [{ id: 'c', name: 'Child', urn: 'hrn:agent:example.com:c' }], hasMore: true, endCursor: 'opaque+/=', failed: false }));
    retryLink(target).click(); await tick(5);
    expect(alertEl(target).textContent?.trim()).toBe('');
    expect(target.querySelector('a[href="/app/agents/c"]')?.textContent).toBe('Child');
    expect([...target.querySelectorAll('nav a')].map(a => a.textContent)).toEqual(['First page', 'Next 20 extending Agents']);
    expect(target.querySelector('a[href="/app/agents/base?extendedAfter=opaque%2B%2F%3D#extended-by"]')).not.toBeNull();
  });

  it('a loader-produced prop replacement supersedes a successful local retry', async () => {
    setStubPage('http://localhost/app/agents/base');
    const props = reactiveProps({ result: { ...empty, failed: true } as typeof empty });
    const m = mountComponent(AgentExtendedBy, { agentId: 'base', requestedAfter: null, get result() { return props.result; } } as never);
    mounted.push(m); await tick(5);
    fetchMock.mockResolvedValueOnce(ok({ items: [{ id: 'c', name: 'Child', urn: 'hrn:agent:example.com:c' }], hasMore: false, endCursor: null, failed: false }));
    m.target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(5);
    expect(m.target.querySelector('a[href="/app/agents/c"]')).not.toBeNull();
    // The user navigates (Next) and THAT read fails: the loader's page wins.
    props.result = { ...empty, failed: true }; await tick(5);
    expect(m.target.querySelector('a[href="/app/agents/c"]')).toBeNull();
    expect(alertEl(m.target).textContent).toBe(FAILED);
    expect(m.target.querySelector<HTMLAnchorElement>('nav a')!.textContent).toBe('Retry');
  });

  it('a rejected re-read after unmount records no unhandled rejection and steals no focus', async () => {
    const rejections = await captureUnhandledRejections(async () => {
      const target = await show({ ...empty, failed: true });
      let signal: AbortSignal | undefined;
      fetchMock.mockImplementationOnce((_input: unknown, init?: RequestInit) => {
        signal = init?.signal ?? undefined;
        return new Promise<Response>((_res, rej) => { signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))); });
      });
      target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(2);
      mounted[mounted.length - 1].unmount();
      // Unmount aborts the pending re-read; its rejection lands in the guarded catch.
      expect(signal?.aborted).toBe(true);
      const other = document.createElement('input'); document.body.append(other); other.focus();
      try { await tick(5); expect(document.activeElement).toBe(other); }
      finally { other.remove(); }
    });
    expect(rejections).toHaveLength(0);
  });

  it('discards a late re-read that outlives an in-page navigation to another cursor', async () => {
    setStubPage('http://localhost/app/agents/base');
    const props = reactiveProps({ requestedAfter: 'opaque+/=' as string | null, result: { items: [] as Array<{ id: string; name: string; urn: string }>, hasMore: false, endCursor: null, failed: true } });
    const m = mountComponent(AgentExtendedBy, props as never); mounted.push(m); await tick(5);
    let finish!: (body: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = body => resolve(ok(body)); }));
    m.target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(2);
    // A "First page" navigation lands while the re-read is still pending.
    props.requestedAfter = null;
    props.result = { items: [{ id: 'first', name: 'First row', urn: 'hrn:agent:example.com:first' }], hasMore: false, endCursor: null, failed: false };
    await tick(2);
    // Whatever the reader focused on the new page keeps focus: the discarded
    // re-read must not steal it back when it finally settles (#1560 review).
    const other = document.createElement('input'); document.body.append(other); other.focus();
    try {
      finish({ items: [{ id: 'stale', name: 'Stale row', urn: 'hrn:agent:example.com:stale' }], hasMore: false, endCursor: null, failed: false }); await tick(5);
      expect(m.target.querySelector('a[href="/app/agents/first"]')?.textContent).toBe('First row');
      expect(m.target.querySelector('a[href="/app/agents/stale"]')).toBeNull();
      expect(document.activeElement).toBe(other);
    } finally { other.remove(); }
  });

  it('aborts a pending re-read when the section moves to another page and re-arms Retry there', async () => {
    setStubPage('http://localhost/app/agents/base');
    const props = reactiveProps({ requestedAfter: 'cursor-x' as string | null, result: { items: [] as Array<{ id: string; name: string; urn: string }>, hasMore: false, endCursor: null, failed: true } });
    const m = mountComponent(AgentExtendedBy, props as never); mounted.push(m); await tick(5);
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementationOnce((_input: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>((_res, rej) => { signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))); });
    });
    const retryLink = () => m.target.querySelector<HTMLAnchorElement>('nav a')!;
    retryLink().click(); await tick(2);
    expect(retryLink().textContent).toBe('Retrying…');
    // In-page navigation to another cursor's failed page while it hangs.
    props.requestedAfter = 'cursor-y';
    props.result = { items: [], hasMore: false, endCursor: null, failed: true };
    await tick(5);
    // The stale read was aborted (not waited out): the destination page's
    // Retry control is live immediately and its alert stands.
    expect(retryLink().textContent).toBe('Retry');
    expect(retryLink().getAttribute('aria-disabled')).toBe('false');
    expect(alertEl(m.target).textContent).toBe('Could not load extending Agents. Retry this page, or return to the first page.');
  });

  it('bounds a stalled re-read by the client deadline: the alert re-arms, Retry is offered again', async () => {
    const target = await show({ ...empty, failed: true });
    fetchMock.mockImplementationOnce((_input: unknown, init?: RequestInit) => {
      const signal = init?.signal ?? undefined;
      return new Promise<Response>((_res, rej) => { signal?.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError'))); });
    });
    const retryLink = () => target.querySelector<HTMLAnchorElement>('nav a')!;
    // Fake timers BEFORE the click: the deadline the component arms must live
    // on the fake clock this test advances (tick is microtask-based, unaffected).
    vi.useFakeTimers();
    try {
      retryLink().click(); await tick(2);
      expect(retryLink().textContent).toBe('Retrying…');
      await vi.advanceTimersByTimeAsync(RETRY_TIMEOUT_MS);
    } finally {
      vi.useRealTimers();
    }
    await tick(5);
    expect(retryLink().textContent).toBe('Retry');
    expect(retryLink().getAttribute('aria-disabled')).toBe('false');
    expect(alertEl(target).textContent).toBe(FAILED);
  });

  it('treats a non-2xx answer as a failure even when its body is a well-formed page', async () => {
    const target = await show({ ...empty, failed: true });
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ items: [{ id: 'ghost', name: 'Ghost', urn: 'hrn:agent:example.com:ghost' }], hasMore: false, endCursor: null, failed: false }) } as Response);
    target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(5);
    expect(target.querySelector('a[href="/app/agents/ghost"]')).toBeNull();
    expect(alertEl(target).textContent).toBe(FAILED);
  });

  it('applies a late re-read that returns to the very page it was issued for', async () => {
    setStubPage('http://localhost/app/agents/base');
    const props = reactiveProps({ requestedAfter: 'opaque+/=' as string | null, result: { items: [] as Array<{ id: string; name: string; urn: string }>, hasMore: false, endCursor: null, failed: true } });
    const m = mountComponent(AgentExtendedBy, props as never); mounted.push(m); await tick(5);
    let finish!: (body: unknown) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = body => resolve(ok(body)); }));
    m.target.querySelector<HTMLAnchorElement>('nav a')!.click(); await tick(2);
    // Same-cursor loader refresh (object identity change only): still this page.
    props.result = { ...empty, failed: true }; await tick(2);
    finish({ items: [{ id: 'same', name: 'Same page row', urn: 'hrn:agent:example.com:same' }], hasMore: false, endCursor: null, failed: false }); await tick(5);
    expect(m.target.querySelector('a[href="/app/agents/same"]')?.textContent).toBe('Same page row');
  });
});
