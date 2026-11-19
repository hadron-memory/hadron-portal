import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import AppRunsTable from './AppRunsTable.svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, resetNavigationCalls, navigationHooks, navigationGuards, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import type { AppRun } from '$lib/flow/runs';
import type { RunsSection } from '$lib/flow/app-runs-page';
import { localStorageViewStore } from '$lib/table/localStorageViewStore';
import { normalizeView } from '$lib/table/savedView';
const run = (id: string): AppRun => ({ id, appId: 'a', organizationId: 'o', agentId: null, userId: null, triggerKind: 'MANUAL', triggerId: null, entryNodeUrn: `hrn:node:test:memory:${id}`, eventData: null, policy: null, budgetTokens: null, budgetActions: null, status: 'COMPLETED', curNodeUrn: null, parentRunId: null, failure: null, timeoutMs: null, attempts: 1, startedAt: null, finishedAt: null, createdAt: '2026-11-01T00:00:00Z', createdBy: null });
const section = (extra: Partial<RunsSection> = {}): RunsSection => ({ runs: [run('old')], total: 100, page: 3, statuses: [], sort: 'createdAt', dir: 'desc', failed: false, explicitState: true, ...extra });
function deferred<T>() { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
const reply = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
let cleanup: (() => void)[] = [];
function mount(initial = section()) { const props = reactiveProps({ appRef: 'a', initial }); const m = mountComponent(AppRunsTable, props); cleanup.push(m.unmount); return { ...m, props }; }
const find = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
const statusBox = (root: HTMLElement, name: string) => [...root.querySelectorAll('label')].find(x => x.textContent?.trim() === name)!.querySelector('input')!;
const selectControl = (root: HTMLElement, label: string) => root.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
const changeSelect = (select: HTMLSelectElement, value: string) => { select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
beforeEach(() => { localStorage.clear(); resetNavigationCalls(); resetNavigationGuards(); });
afterEach(() => { cleanup.forEach(f => f()); cleanup = []; resetNavigationGuards(); document.body.removeAttribute('tabindex'); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('App Runs manual server table', () => {
  it('does not navigate or flash busy when the initial saved query already matches', async () => {
    const v = await localStorageViewStore.create('app-runs-server', 'Default', normalizeView({ sorting: [{ id: 'createdAt', desc: true }], columnVisibility: { failure: false } }));
    await localStorageViewStore.setDefault('app-runs-server', v.id);
    const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
    const m = mount(section({ page: 1, explicitState: false })); await tick(32);
    expect(navigationCalls).toEqual([]);
    expect(m.target.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect([...m.target.querySelectorAll('th')].some(x => x.textContent?.trim() === 'Failure')).toBe(false);
    held.resolve(); await tick(8);
  });
  it('replaces history for initial saved-query sync but pushes a deliberate view selection', async () => {
    const v = await localStorageViewStore.create('app-runs-server', 'Default', normalizeView({ sorting: [{ id: 'status', desc: false }], columnFilters: [{ id: 'status', value: ['FAILED'] }] }));
    await localStorageViewStore.setDefault('app-runs-server', v.id);
    await localStorageViewStore.create('app-runs-server', 'Another', normalizeView({ sorting: [{ id: 'finishedAt', desc: true }] }));
    const m = mount(section({ page: 1, explicitState: false })); await tick(32);
    const initial = navigationCalls.filter(x => x.fn === 'goto');
    expect(initial).toHaveLength(1);
    expect(initial[0].args[1]).toMatchObject({ replaceState: true, keepFocus: true, noScroll: true });
    expect(new URL(initial[0].args[0] as string, 'https://test').searchParams.get('status')).toBe('FAILED');
    m.props.initial = section({ page: 1, explicitState: true, sort: 'status', dir: 'asc', statuses: ['FAILED'] }); flushSync(); await tick(8);
    find(m.target, 'Another').click(); await tick(16);
    const selected = navigationCalls.filter(x => x.fn === 'goto');
    expect(selected).toHaveLength(2);
    expect(selected[1].args[1]).toMatchObject({ replaceState: false });
    expect(new URL(selected[1].args[0] as string, 'https://test').searchParams.get('sort')).toBe('finishedAt');
  });
  it.each(['destroy', 'App change', 'served query', 'new intent'])('does not let delayed saved-view init overtake %s', async boundary => {
    const v = await localStorageViewStore.create('app-runs-server', 'Default', normalizeView({ sorting: [{ id: 'status', desc: false }], columnFilters: [{ id: 'status', value: ['FAILED'] }] }));
    await localStorageViewStore.setDefault('app-runs-server', v.id);
    const views = await localStorageViewStore.list('app-runs-server');
    const held = deferred<typeof views>(); vi.spyOn(localStorageViewStore, 'list').mockReturnValueOnce(held.promise);
    const m = mount(section({ page: 1, explicitState: false })); await tick(4);
    if (boundary === 'destroy') m.unmount();
    else if (boundary === 'App change') { m.props.appRef = 'b'; m.props.initial = section({ page: 1 }); flushSync(); }
    else if (boundary === 'served query') { m.props.initial = section({ page: 1, sort: 'finishedAt' }); flushSync(); }
    else { find(m.target, 'Active').click(); await tick(8); }
    const before = navigationCalls.filter(x => x.fn === 'goto').length;
    held.resolve(views); await tick(32);
    expect(navigationCalls.filter(x => x.fn === 'goto')).toHaveLength(before);
  });
  it('renders the accepted SPAWN trigger as a named cell', async () => {
    const m = mount(section({ runs: [{ ...run('spawn'), triggerKind: 'SPAWN' }] })); await tick(8);
    expect(m.target.querySelector('tbody tr td:nth-child(2)')?.textContent?.trim()).toBe('Spawn');
  });
  it('keeps a held filter when the next choice changes sorting', async () => {
    const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
    const m = mount(); await tick(8);
    statusBox(m.target, 'FAILED').click(); await tick(4);
    changeSelect(selectControl(m.target, 'Sort runs by'), 'status'); await tick(4);
    const url = new URL(navigationCalls.at(-1)!.args[0] as string, 'https://test');
    expect(url.searchParams.get('status')).toBe('FAILED'); expect(url.searchParams.get('sort')).toBe('status');
    held.resolve(); await tick(4);
  });
  it('restores the served checkbox after navigation rejects', async () => {
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    const m = mount(); await tick(8);
    const checkbox = statusBox(m.target, 'FAILED'); checkbox.click(); await tick(8);
    expect(checkbox.checked).toBe(false);
  });
  it('restores the served sort after navigation rejects', async () => {
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    const m = mount(); await tick(8);
    const sort = selectControl(m.target, 'Sort runs by'); changeSelect(sort, 'status'); await tick(8);
    expect(sort.value).toBe('createdAt');
  });
  it('restores the served direction after navigation rejects', async () => {
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    const m = mount(); await tick(8);
    const direction = selectControl(m.target, 'Run sort order'); changeSelect(direction, 'asc'); await tick(8);
    expect(direction.value).toBe('desc');
  });
  it('lets served data replace intent before the old navigation settles', async () => {
    const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
    const m = mount(); await tick(8);
    const checkbox = statusBox(m.target, 'FAILED'); checkbox.click(); await tick(4);
    m.props.initial = section({ statuses: [], page: 1 }); flushSync(); await tick(4);
    expect(checkbox.checked).toBe(false);
    expect(m.target.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    held.resolve(); await tick(8);
    expect(checkbox.checked).toBe(false);
  });
  it('renders all20 served rows on page3 without local re-page or re-sort, and changes only the URL on sort', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ ...run(`row-${20 - i}`), startedAt: `2026-11-01T00:00:${String(i).padStart(2, '0')}Z` }));
    const m = mount(section({ runs: rows, sort: 'startedAt' })); await tick(8);
    expect(m.target.querySelectorAll('tbody tr')).toHaveLength(20);
    expect(m.target.querySelector('tbody tr')?.textContent).toContain('row-20');
    expect(m.target.querySelector('select[aria-label="Rows per page"]')).toBeNull();
    expect(m.target.querySelector('input[type=text]')).toBeNull();
    find(m.target, 'Status').click(); await tick(4);
    const url = new URL(navigationCalls.at(-1)!.args[0] as string, 'https://test');
    expect(url.searchParams.get('sort')).toBe('status'); expect(url.searchParams.has('page')).toBe(false);
    expect(m.target.querySelector('tbody tr')?.textContent).toContain('row-20');
    expect([...m.target.querySelectorAll('th')].find(e => e.textContent?.trim() === 'Duration')?.querySelector('button')).toBeNull();
  });
  it('keeps an explicit URL slice on saved-view init while restoring column arrangement', async () => {
    const v = await localStorageViewStore.create('app-runs-server', 'Saved', normalizeView({ sorting: [{ id: 'status', desc: false }], columnFilters: [{ id: 'status', value: ['FAILED'] }], columnVisibility: { failure: false }, pagination: { pageIndex: 9, pageSize: 100 } }));
    await localStorageViewStore.setDefault('app-runs-server', v.id); await localStorageViewStore.setActiveId('app-runs-server', v.id);
    const m = mount(); await tick(32);
    expect(navigationCalls).toEqual([]); expect(m.target.querySelector<HTMLSelectElement>('select[aria-label="Sort runs by"]')?.value).toBe('createdAt');
    expect([...m.target.querySelectorAll('th')].some(x => x.textContent?.trim() === 'Failure')).toBe(false);
    expect(m.target.textContent).toContain('3 of');
  });
  it('a section retry cannot apply or release pending after a newer App/view owns it', async () => {
    const a = deferred<Response>(), b = deferred<Response>();
    const fetcher = vi.fn().mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise); vi.stubGlobal('fetch', fetcher);
    const m = mount(section({ failed: true })); find(m.target, 'Retry').click(); flushSync();
    m.props.appRef = 'b'; m.props.initial = section({ failed: true, page: 1 }); flushSync();
    find(m.target, 'Retry').click(); flushSync();
    a.resolve(reply(section({ runs: [run('obsolete')] }))); await tick(16);
    expect(m.target.textContent).not.toContain('obsolete'); expect(m.target.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
    b.resolve(reply(section({ page: 1, runs: [run('current')] }))); await tick(24);
    expect(m.target.textContent).toContain('current'); expect(m.target.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    expect(navigationCalls).toEqual([]); expect(fetcher.mock.calls[1][0]).toContain('/app/apps/b/runs-data');
  });
  it('malformed or failed retry stays an error, and teardown launches no navigation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply({ runs: [], total: 0 })));
    const m = mount(section({ failed: true })); find(m.target, 'Retry').click(); await tick(16);
    expect(m.target.querySelector('[role=alert]')?.textContent).toContain('Could not load runs');
    expect(m.target.textContent).not.toContain('No runs yet'); expect(navigationCalls).toEqual([]);
    const held = deferred<Response>(); vi.stubGlobal('fetch', () => held.promise);
    find(m.target, 'Retry').click(); m.unmount(); held.resolve(reply(section())); await tick(16);
    expect(navigationCalls).toEqual([]);
  });
  it('keeps filters enabled and merges a newer choice while navigation is held', async () => {
    const a = deferred<void>(), b = deferred<void>();
    let call = 0; navigationHooks.onGoto = () => ++call === 1 ? a.promise : b.promise;
    const m = mount(); await tick(8);
    const labels = [...m.target.querySelectorAll('label')];
    const failed = labels.find(x => x.textContent?.trim() === 'FAILED')!.querySelector('input')!;
    const running = labels.find(x => x.textContent?.trim() === 'RUNNING')!.querySelector('input')!;
    failed.focus(); failed.click(); await tick(4);
    expect(failed.matches(':disabled')).toBe(false);
    expect(document.activeElement).toBe(failed);
    running.focus(); running.click(); await tick(4);
    const url = new URL(navigationCalls.at(-1)!.args[0] as string, 'https://test');
    expect(url.searchParams.get('status')).toBe('RUNNING,FAILED');
    expect(navigationCalls.filter(x => x.fn === 'goto')).toHaveLength(2);
    a.resolve(); await tick(8);
    expect(m.target.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
    expect(failed.checked).toBe(true); expect(running.checked).toBe(true);
    m.props.initial = section({ page: 1, statuses: ['RUNNING', 'FAILED'] }); flushSync();
    b.resolve(); await tick(8);
    expect(document.activeElement).toBe(running);
    expect(failed.checked).toBe(true); expect(running.checked).toBe(true);
  });
  it('does not move a live filter focus to the heading after navigation', async () => {
    const m = mount(); await tick(8);
    const sort = m.target.querySelector<HTMLSelectElement>('select[aria-label="Sort runs by"]')!;
    sort.focus();
    for (const guard of navigationGuards.filter(x => x.fn === 'afterNavigate')) {
      (guard.callback as (n: { type: string }) => void)({ type: 'goto' });
    }
    await tick(8);
    expect(document.activeElement).toBe(sort);
  });

  it('ignores a late navigation error without releasing a newer intent', async () => {
    const a = deferred<void>(), b = deferred<void>();
    let call = 0; navigationHooks.onGoto = () => ++call === 1 ? a.promise : b.promise;
    const m = mount(); await tick(8);
    find(m.target, 'Active').click(); await tick(4);
    find(m.target, 'All').click(); await tick(4);
    a.reject(new Error('obsolete')); await tick(8);
    expect(m.target.textContent).not.toContain('Could not open this runs page');
    expect(m.target.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true');
    b.reject(new Error('current')); await tick(8);
    expect(m.target.textContent).toContain('Could not open this runs page');
    expect(m.target.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false');
    navigationHooks.onGoto = undefined; find(m.target, 'Active').click(); await tick(8);
    expect(m.target.textContent).not.toContain('Could not open this runs page');
    navigationHooks.onGoto = async () => { throw new Error('current again'); };
    find(m.target, 'All').click(); await tick(8);
    expect(m.target.textContent).toContain('Could not open this runs page');
    m.props.appRef = 'b'; m.props.initial = section({ page: 1 }); flushSync(); await tick(8);
    expect(m.target.textContent).not.toContain('Could not open this runs page');
  });
  it('does not let a queued focus fallback reach a newer App view', async () => {
    const m = mount(); await tick(8);
    document.body.tabIndex = -1; document.body.focus();
    for (const guard of navigationGuards.filter(x => x.fn === 'afterNavigate')) {
      (guard.callback as (n: { type: string }) => void)({ type: 'goto' });
    }
    m.props.appRef = 'b'; m.props.initial = section({ page: 1 }); flushSync();
    await tick(8);
    expect(document.activeElement).toBe(document.body);
  });

  it('does not report an invented zero total on a failed read', async () => {
    const failed = mount(section({ runs: [], total: 0, failed: true })); await tick(8);
    expect(failed.target.querySelector('[role=alert]')?.textContent).toContain('Could not load runs');
    expect(failed.target.textContent).not.toContain('Total:');
    const empty = mount(section({ runs: [], total: 0, failed: false })); await tick(8);
    expect(empty.target.querySelector('[role=alert]')).toBeNull();
    expect(empty.target.textContent).toContain('Total: 0');
    expect(empty.target.textContent).toContain('No runs yet');
  });

});
// portal#2291 (Uma's row 3 on #2289): focus stays on the control after a
// navigate, so the polite live region must say what the served page now holds.
describe('App Runs announces the served result after a successful navigate (portal#2291)', () => {
  const live = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!;
  /** Kit applies the new page data before `goto` resolves: serve, then settle. */
  async function navigateAndServe(m: ReturnType<typeof mount>, act: () => void, served: RunsSection) {
    const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
    act(); await tick(4);
    m.props.initial = served; flushSync(); await tick(4);
    held.resolve(); await tick(8);
    navigationHooks.onGoto = undefined;
  }
  it.each([
    [45, 'page 1 of 3', '45 runs'],
    [7, 'page 1 of 1', '7 runs'],
    [0, 'page 1 of 1', '0 runs'],
    [1, 'page 1 of 1', '1 run'],
  ])('a filter change with %i served runs reads "%s"', async (total, pages, count) => {
    const m = mount(); await tick(8);
    await navigateAndServe(m, () => find(m.target, 'Active').click(), section({ page: 1, total, statuses: ['PENDING', 'RUNNING'], runs: total ? [run('n')] : [] }));
    expect(live(m.target).textContent).toBe(`${count}, sorted by Created, ${pages}`);
  });
  it('a sort change reads the new sort label', async () => {
    const m = mount(); await tick(8);
    await navigateAndServe(m, () => changeSelect(selectControl(m.target, 'Sort runs by'), 'status'), section({ page: 1, total: 100, sort: 'status' }));
    expect(live(m.target).textContent).toBe('100 runs, sorted by Status, page 1 of 5');
  });
  it('a pager click reads the served page, not the requested one', async () => {
    const m = mount(section({ page: 3, total: 100 })); await tick(8);
    // The server clamps: the request asked for page 4, the served page is 2.
    await navigateAndServe(m, () => find(m.target, 'Next').click(), section({ page: 2, total: 30, sort: 'finishedAt' }));
    expect(live(m.target).textContent).toBe('30 runs, sorted by Finished, page 2 of 2');
  });
  it('a failed navigation reads the failure text only', async () => {
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    const m = mount(); await tick(8);
    find(m.target, 'Active').click(); await tick(8);
    expect(live(m.target).textContent).toBe('Could not open this runs page. Try again.');
  });
  it('a successful retry still reads exactly "Runs loaded."', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(section({ page: 1, total: 3 }))));
    const m = mount(section({ failed: true })); find(m.target, 'Retry').click(); await tick(16);
    expect(live(m.target).textContent).toBe('Runs loaded.');
  });
  it('a superseded navigation never announces; the newer served result does', async () => {
    const a = deferred<void>(), b = deferred<void>();
    let call = 0; navigationHooks.onGoto = () => ++call === 1 ? a.promise : b.promise;
    const m = mount(); await tick(8);
    find(m.target, 'Active').click(); await tick(4);
    find(m.target, 'All').click(); await tick(4);
    m.props.initial = section({ page: 1, total: 12 }); flushSync(); await tick(4);
    b.resolve(); await tick(8);
    a.resolve(); await tick(8);
    expect(live(m.target).textContent).toBe('12 runs, sorted by Created, page 1 of 1');
  });
  it('served data that no navigate of this view asked for announces nothing (App change, refresh)', async () => {
    const m = mount(); await tick(8);
    m.props.initial = section({ page: 1, total: 9 }); flushSync(); await tick(8);
    expect(live(m.target).textContent).toBe('');
    const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
    find(m.target, 'Active').click(); await tick(4);
    m.props.appRef = 'b'; m.props.initial = section({ page: 1, total: 4 }); flushSync(); await tick(4);
    held.resolve(); await tick(8);
    expect(live(m.target).textContent).toBe('');
  });
  it('a failed navigate does not let later, unrequested data announce itself', async () => {
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    const m = mount(); await tick(8);
    find(m.target, 'Active').click(); await tick(8);
    navigationHooks.onGoto = undefined;
    m.props.initial = section({ page: 1, total: 5 }); flushSync(); await tick(8);
    expect(live(m.target).textContent).toBe('');
  });
  it('a navigate that serves no new data does not let a later refresh announce itself', async () => {
    // goto resolves (e.g. the same URL again) but no new page data arrives: nothing asked for the later data.
    navigationHooks.onGoto = async () => {};
    const m = mount(); await tick(8);
    find(m.target, 'Active').click(); await tick(8);
    m.props.initial = section({ page: 1, total: 5 }); flushSync(); await tick(8);
    expect(live(m.target).textContent).toBe('');
  });
  it('keeps one polite live region', async () => {
    const m = mount(); await tick(8);
    await navigateAndServe(m, () => find(m.target, 'Active').click(), section({ page: 1, total: 2 }));
    expect(m.target.querySelectorAll('[role="status"]')).toHaveLength(1);
    expect(m.target.querySelectorAll('[aria-live="assertive"]')).toHaveLength(0);
  });
});
