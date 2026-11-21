import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { runAppFlowSchema } from '../../routes/app/apps/[appId]/runs/schema';
import AppRunsPanel from '../../routes/app/apps/[appId]/runs/AppRunsPanel.svelte';
import { flushSync } from 'svelte';
import AppRunsTable from './AppRunsTable.svelte';
// portal#2286: a test can stub a `t()` key to prove the label comes from the i18n boundary.
const stubbed = vi.hoisted(() => ({ keys: {} as Record<string, string> }));
vi.mock('$lib/i18n/t', async orig => { const real = await orig<typeof import('$lib/i18n/t')>(); return { ...real, t: (id: string, def: string, vars?: Record<string, string | number | null | undefined>) => stubbed.keys[id] ?? real.t(id, def, vars) }; });
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
beforeEach(() => { stubbed.keys = {}; localStorage.clear(); resetNavigationCalls(); resetNavigationGuards(); });
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
  it('renders well-shaped unknown enums as Unknown: raw in a neutral chip, borrowing no known state (#1766)', async () => {
    const m = mount(section({ runs: [{ ...run('paused'), status: 'PAUSED', triggerKind: 'FUTURE_KIND' }] })); await tick(8);
    const chip = m.target.querySelector('tbody tr td:nth-child(1) span') as HTMLElement;
    expect(chip.textContent?.trim()).toBe('Unknown: PAUSED');
    expect(chip.className).toContain('border-zinc-300');
    expect(chip.className).not.toContain('amber');
    expect(m.target.querySelector('tbody tr td:nth-child(2)')?.textContent?.trim()).toBe('Unknown: FUTURE_KIND');
  });
  it('keeps a held filter when the next choice changes sorting', async () => {
    const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
    const m = mount(); await tick(8);
    statusBox(m.target, 'Failed').click(); await tick(4);
    changeSelect(selectControl(m.target, 'Sort runs by'), 'status'); await tick(4);
    const url = new URL(navigationCalls.at(-1)!.args[0] as string, 'https://test');
    expect(url.searchParams.get('status')).toBe('FAILED'); expect(url.searchParams.get('sort')).toBe('status');
    held.resolve(); await tick(4);
  });
  it('restores the served checkbox after navigation rejects', async () => {
    navigationHooks.onGoto = async () => { throw new Error('navigation rejected'); };
    const m = mount(); await tick(8);
    const checkbox = statusBox(m.target, 'Failed'); checkbox.click(); await tick(8);
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
    const checkbox = statusBox(m.target, 'Failed'); checkbox.click(); await tick(4);
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
  // portal#1767 rows 1-4: the four Retry guards, one pin each. Every malformed
  // body below still RENDERS if its guard is deleted, so each pin fails on its
  // own assertions — the hand-mutant survey found the old malformed pin only
  // died on the unhandled render exception of a body missing `statuses`.
  const liveRegion = (root: HTMLElement) => root.querySelector<HTMLElement>('[role="status"][aria-live="polite"]')!;
  it('refuses a malformed 200 body: the alert stays, no rows apply, no "Runs loaded." (row 1: delete the isRunsSection guard)', async () => {
    // Every field renders; only `sort` violates isRunsSection, so a deleted
    // guard applies this body instead of crashing the render.
    const malformed = section({ page: 1, sort: 'garbage' as never, runs: [run('ghost')] });
    const fetcher = vi.fn().mockResolvedValue(reply(malformed));
    vi.stubGlobal('fetch', fetcher);
    const m = mount(section({ failed: true, page: 1 })); find(m.target, 'Retry').click(); await tick(16);
    // The alert is already up before Retry, so prove the click really re-read.
    expect(fetcher).toHaveBeenCalledTimes(1);
    const alert = m.target.querySelector('[role=alert]');
    expect(alert, 'the failure alert stays up').toBeTruthy();
    expect(alert?.textContent).toContain('Could not load runs');
    expect(m.target.textContent).not.toContain('ghost');
    expect(liveRegion(m.target).textContent).not.toBe('Runs loaded.');
  });
  it('refuses a non-ok response even when its body is a valid section (row 2: delete the res.ok guard)', async () => {
    // A full Response, not a partial: only `ok`/`status` differ from a good
    // reply, so deleting the res.ok guard applies this valid body.
    const notOk = new Response(JSON.stringify(section({ page: 1, runs: [run('ghost')] })), { status: 500, headers: { 'content-type': 'application/json' } });
    const fetcher = vi.fn().mockResolvedValue(notOk);
    vi.stubGlobal('fetch', fetcher);
    const m = mount(section({ failed: true, page: 1 })); find(m.target, 'Retry').click(); await tick(16);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const alert = m.target.querySelector('[role=alert]');
    expect(alert, 'the failure alert stays up').toBeTruthy();
    expect(alert?.textContent).toContain('Could not load runs');
    expect(m.target.textContent).not.toContain('ghost');
    expect(liveRegion(m.target).textContent).not.toBe('Runs loaded.');
  });
  it('encodes a reserved-character app ref into the runs-data path (row 3: interpolate ref raw)', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(section({ page: 1 })));
    vi.stubGlobal('fetch', fetcher);
    const props = reactiveProps({ appRef: 'a/b?x', initial: section({ failed: true, page: 1 }) });
    const m = mountComponent(AppRunsTable, props); cleanup.push(m.unmount);
    find(m.target, 'Retry').click(); await tick(16);
    expect(fetcher.mock.calls[0][0]).toBe('/app/apps/a%2Fb%3Fx/runs-data?tab=runs&sort=createdAt&dir=desc');
  });
  it('re-reads runs-data with exactly { cache: "no-store" } (row 4: drop the init argument)', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply(section({ page: 1 })));
    vi.stubGlobal('fetch', fetcher);
    const m = mount(section({ failed: true, page: 1 })); find(m.target, 'Retry').click(); await tick(16);
    expect(fetcher.mock.calls[0][1]).toEqual({ cache: 'no-store' });
  });
  it('keeps filters enabled and merges a newer choice while navigation is held', async () => {
    const a = deferred<void>(), b = deferred<void>();
    let call = 0; navigationHooks.onGoto = () => ++call === 1 ? a.promise : b.promise;
    const m = mount(); await tick(8);
    const labels = [...m.target.querySelectorAll('label')];
    const failed = labels.find(x => x.textContent?.trim() === 'Failed')!.querySelector('input')!;
    const running = labels.find(x => x.textContent?.trim() === 'Running')!.querySelector('input')!;
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
  // portal#2290 row 2: while a request is held, the request the reader waits on is the base for the next click.
  describe('pager and sort header follow the held request (portal#2290)', () => {
    const goto = () => navigationCalls.filter(x => x.fn === 'goto');
    const lastUrl = () => new URL(goto().at(-1)!.args[0] as string, 'https://test');
    it('Next from a held intent on page 1 asks page 2, never served page 3 + 1', async () => {
      const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
      const m = mount(); await tick(8);
      statusBox(m.target, 'Failed').click(); await tick(4);
      expect(lastUrl().searchParams.get('page')).toBeNull();
      find(m.target, 'Next').click(); await tick(4);
      expect(goto()).toHaveLength(2);
      expect(lastUrl().searchParams.get('page')).toBe('2');
      expect(lastUrl().searchParams.get('status')).toBe('FAILED');
      held.resolve(); await tick(8);
    });
    it('Previous from a held intent on page 1 makes no request', async () => {
      const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
      const m = mount(); await tick(8);
      statusBox(m.target, 'Failed').click(); await tick(4);
      find(m.target, 'Previous').click(); await tick(4);
      expect(goto()).toHaveLength(1);
      held.resolve(); await tick(8);
    });
    it('does not disable the pager or the sort header while a request is held', async () => {
      const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
      const m = mount(); await tick(8);
      find(m.target, 'Previous').click(); await tick(4);
      expect(lastUrl().searchParams.get('page')).toBe('2');
      for (const el of [find(m.target, 'Previous'), find(m.target, 'Next'), find(m.target, 'Started')]) {
        expect(el.hasAttribute('disabled')).toBe(false);
        expect(el.hasAttribute('aria-disabled')).toBe(false);
      }
      held.resolve(); await tick(8);
    });
    it('a second header click while the first is held toggles from the held sort, not the served one', async () => {
      const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
      const m = mount(); await tick(8);
      find(m.target, 'Started').click(); await tick(4);
      const first = lastUrl().searchParams.get('dir');
      find(m.target, 'Started').click(); await tick(4);
      expect(goto()).toHaveLength(2);
      expect(lastUrl().searchParams.get('sort')).toBe('startedAt');
      expect([first, lastUrl().searchParams.get('dir')]).toEqual(['desc', 'asc']);
      held.resolve(); await tick(8);
    });
    it('a rejected held request rolls the pager back to the served page', async () => {
      const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
      const m = mount(); await tick(8);
      statusBox(m.target, 'Failed').click(); await tick(4);
      held.reject(new Error('offline')); await tick(8);
      navigationHooks.onGoto = undefined;
      find(m.target, 'Next').click(); await tick(4);
      expect(goto()).toHaveLength(2);
      expect(lastUrl().searchParams.get('page')).toBe('4');
      expect(lastUrl().searchParams.get('status')).toBeNull();
    });
    it('an interrupted request leaves the newer request as the base, even after the older one settles', async () => {
      const a = deferred<void>(), b = deferred<void>();
      let call = 0; navigationHooks.onGoto = () => ++call === 1 ? a.promise : b.promise;
      const m = mount(); await tick(8);
      statusBox(m.target, 'Failed').click(); await tick(4);
      statusBox(m.target, 'Running').click(); await tick(4);
      a.resolve(); await tick(8);
      find(m.target, 'Next').click(); await tick(4);
      expect(goto()).toHaveLength(3);
      expect(lastUrl().searchParams.get('page')).toBe('2');
      expect(lastUrl().searchParams.get('status')).toBe('RUNNING,FAILED');
      b.resolve(); await tick(8);
    });
    it('Previous while held steps back from the held page', async () => {
      const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
      const m = mount(section({ page: 5 })); await tick(8);
      find(m.target, 'Previous').click(); await tick(4);
      find(m.target, 'Previous').click(); await tick(4);
      expect(goto()).toHaveLength(2);
      expect(lastUrl().searchParams.get('page')).toBe('3');
      held.resolve(); await tick(8);
    });
    it('a header sort click while a filter is held keeps the held filter', async () => {
      const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
      const m = mount(); await tick(8);
      statusBox(m.target, 'Failed').click(); await tick(4);
      find(m.target, 'Started').click(); await tick(4);
      expect(goto()).toHaveLength(2);
      expect(lastUrl().searchParams.get('status')).toBe('FAILED');
      expect(lastUrl().searchParams.get('sort')).toBe('startedAt');
      held.resolve(); await tick(8);
    });
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
    // portal#2286: the unfiltered empty case is the panel's one explainer; the table adds no second statement.
    expect(empty.target.textContent).not.toContain('Total:');
    expect(empty.target.textContent).not.toContain('No runs yet');
    const filtered = mount(section({ runs: [], total: 0, failed: false, statuses: ['FAILED'] })); await tick(8);
    expect(filtered.target.textContent).toContain('Total: 0');
    expect(filtered.target.textContent).toContain('No runs with this status yet.');
  });

  // portal#2286 — the four Runs-controls cues.
  const pressed = (root: HTMLElement, label: string) => find(root, label).getAttribute('aria-pressed');
  const panelData = async (over: Record<string, unknown> = {}) => ({
    app: { id: 'app-1', name: 'Digest', organizationId: 'org-1' },
    runs: [], total: 0, page: 1, pageSize: 20, status: null, statuses: [], sort: 'createdAt', dir: 'desc', failed: false, explicitState: true,
    flows: [], flowsPage: { offset: 0, count: 0, total: 0, firstHref: null, previousHref: null, nextHref: null },
    runForm: await superValidate(zod4(runAppFlowSchema), { errors: false }), runAgents: null, ...over,
  });
  it('an unfiltered empty page states "no runs" exactly once', async () => {
    setStubPage('http://localhost/app/apps/app-1?tab=runs', { appId: 'app-1' });
    const m = mountComponent(AppRunsPanel as never, { data: await panelData(), form: null } as never); cleanup.push(m.unmount); await tick(8);
    const text = m.target.textContent ?? '';
    expect(text.match(/Runs start from a trigger/g)).toHaveLength(1);
    expect(text).not.toContain('No runs yet');
    expect(text).not.toContain('Total:');
  });
  it('a filtered empty page keeps its one filtered message', async () => {
    setStubPage('http://localhost/app/apps/app-1?tab=runs', { appId: 'app-1' });
    const m = mountComponent(AppRunsPanel as never, { data: await panelData({ statuses: ['FAILED'] }), form: null } as never); cleanup.push(m.unmount); await tick(8);
    const text = m.target.textContent ?? '';
    expect(text.match(/No runs with this status yet\./g)).toHaveLength(1);
    expect(text).not.toContain('Runs start from a trigger');
    expect(text).not.toContain('No runs yet');
  });
  it('a failed first read that Retry recovers to an empty unfiltered list still states "no runs" once', async () => {
    setStubPage('http://localhost/app/apps/app-1?tab=runs', { appId: 'app-1' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(section({ runs: [], total: 0, page: 1 }))));
    const m = mountComponent(AppRunsPanel as never, { data: await panelData({ failed: true }), form: null } as never); cleanup.push(m.unmount); await tick(8);
    find(m.target, 'Retry').click(); await tick(24);
    const text = m.target.textContent ?? '';
    expect(text).not.toContain('Could not load runs');
    expect((text.match(/No runs yet\./g) ?? []).length + (text.match(/Runs start from a trigger/g) ?? []).length).toBe(1);
  });
  it('an inherited Object.prototype key is not a status label', async () => {
    const m = mount(section({ runs: [{ ...run('x'), status: 'constructor' as never }] })); await tick(8);
    expect(m.target.textContent).toContain('constructor');
    expect(m.target.textContent).not.toContain('function Object');
  });
  it.each([
    ['createdAt', 'desc', 'Sorted by Created, newest first'], ['createdAt', 'asc', 'Sorted by Created, oldest first'],
    ['startedAt', 'asc', 'Sorted by Started, oldest first'], ['finishedAt', 'desc', 'Sorted by Finished, newest first'],
    ['status', 'asc', 'Sorted by Status, A to Z'], ['status', 'desc', 'Sorted by Status, Z to A'],
  ] as const)('summarises %s %s as one line, with no extra column', async (sort, dir, line) => {
    const m = mount(section({ sort, dir })); await tick(8);
    expect(m.target.querySelector('[data-testid="runs-sort-summary"]')?.textContent?.trim()).toBe(line);
    expect(m.target.querySelectorAll('thead th')).toHaveLength(7);
  });
  it('the sort summary follows a pending sort choice before the page is served', async () => {
    const held = deferred<void>(); navigationHooks.onGoto = () => held.promise;
    const m = mount(); await tick(8);
    changeSelect(selectControl(m.target, 'Sort runs by'), 'startedAt'); await tick(4);
    expect(m.target.querySelector('[data-testid="runs-sort-summary"]')?.textContent?.trim()).toBe('Sorted by Started, newest first');
    held.resolve(); await tick(4);
  });
  it.each([
    [[], 'true', 'false'], [['PENDING', 'RUNNING'], 'false', 'true'], [['RUNNING', 'PENDING'], 'false', 'true'],
    [['RUNNING'], 'false', 'false'], [['PENDING'], 'false', 'false'], [['PENDING', 'RUNNING', 'FAILED'], 'false', 'false'],
  ] as const)('All/Active aria-pressed follows statuses %j', async (statuses, all, active) => {
    const m = mount(section({ statuses: [...statuses] as never })); await tick(8);
    expect(pressed(m.target, 'All')).toBe(all); expect(pressed(m.target, 'Active')).toBe(active);
  });
  it('chip and checkbox labels come from t(), and an unknown status renders Unknown: raw (#1766)', async () => {
    stubbed.keys['runs.status.RUNNING'] = 'Läuft';
    const m = mount(section({ runs: [{ ...run('r1'), status: 'RUNNING' }, { ...run('r2'), status: 'PAUSED' as never }] })); await tick(8);
    expect(statusBox(m.target, 'Läuft')).toBeTruthy();
    const chips = [...m.target.querySelectorAll('tbody tr td:first-child span')].map(x => x.textContent?.trim());
    // #1766 (merged over #2286): an unknown status never renders bare — the reader sees it is unknown.
    expect(chips).toEqual(['Läuft', 'Unknown: PAUSED']);
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
  it('a navigate that serves a FAILED section reads the failure, never "0 runs" (blind P2 on #2306)', async () => {
    const m = mount(); await tick(8);
    await navigateAndServe(m, () => find(m.target, 'Active').click(), section({ page: 1, total: 0, failed: true, statuses: ['PENDING', 'RUNNING'], runs: [] }));
    expect(live(m.target).textContent).toBe('Could not load runs. Try again.');
    expect(live(m.target).textContent).not.toMatch(/\bruns?,/);
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
