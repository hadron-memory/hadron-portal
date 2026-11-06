import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { flushSync } from 'svelte';
import AppRunsTable from './AppRunsTable.svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import type { AppRun } from '$lib/flow/runs';
import type { RunsSection } from '$lib/flow/app-runs-page';
import { localStorageViewStore } from '$lib/table/localStorageViewStore';
import { normalizeView } from '$lib/table/savedView';
const run = (id: string): AppRun => ({ id, appId: 'a', organizationId: 'o', agentId: null, userId: null, triggerKind: 'MANUAL', triggerId: null, entryNodeUrn: `hrn:node:test:memory:${id}`, eventData: null, policy: null, budgetTokens: null, budgetActions: null, status: 'COMPLETED', curNodeUrn: null, parentRunId: null, failure: null, timeoutMs: null, attempts: 1, startedAt: null, finishedAt: null, createdAt: '2026-11-01T00:00:00Z', createdBy: null });
const section = (extra: Partial<RunsSection> = {}): RunsSection => ({ runs: [run('old')], total: 100, page: 3, statuses: [], sort: 'createdAt', dir: 'desc', failed: false, explicitState: true, ...extra });
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => resolve = r); return { promise, resolve }; }
const reply = (value: unknown) => ({ ok: true, json: async () => value }) as Response;
let cleanup: (() => void)[] = [];
function mount(initial = section()) { const props = reactiveProps({ appRef: 'a', initial }); const m = mountComponent(AppRunsTable, props); cleanup.push(m.unmount); return { ...m, props }; }
const find = (root: HTMLElement, label: string) => [...root.querySelectorAll('button')].find(b => b.textContent?.trim() === label)!;
beforeEach(() => { localStorage.clear(); resetNavigationCalls(); });
afterEach(() => { cleanup.forEach(f => f()); cleanup = []; vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('App Runs manual server table', () => {
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
});
