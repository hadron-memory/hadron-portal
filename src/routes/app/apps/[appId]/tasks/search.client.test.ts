import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Harness from '$lib/test/fixtures/TaskBoardHarness.svelte';
import { localStorageViewStore } from '$lib/table/localStorageViewStore';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); localStorage.clear(); });
const data = (over: Record<string, unknown> = {}) => ({
  app: { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
  view: 'board', filter: 'all', text: 'description-needle', boardLimit: 200, loadedAt: '2026-10-29T00:00:00Z', impersonating: null,
  board: { kind: 'ok', value: { capped: false, tasks: Array.from({ length: 45 }, (_, i) => ({
    id: `t${i}`, title: `Task ${i}`, parentTaskId: null, status: 'STARTED', queued: false, waitingOnChildren: false,
    source: null, owner: { id: 'u1', kind: 'USER', name: 'Test', urn: null }, assignee: null,
    startBy: null, createdAt: '2026-10-29T00:00:00Z', updatedAt: null, tags: [],
  })) } }, ...over,
});
async function mount(over = {}) {
  const m = mountComponent(Harness as never, { initial: data(over) } as never) as Mounted<any>;
  mounted.push(m); await tick(4); return m;
}
const button = (m: Mounted<any>, text: string) => [...m.target.querySelectorAll('button')].find(b => b.textContent?.trim() === text)!;

describe('task board native search', () => {
  it('renders only one search, preserves status, uses native GET and encodes clear/status links', async () => {
    const m = await mount({ text: '%_\\ &+' });
    expect(m.target.querySelectorAll('input[type=search],input[type=text]')).toHaveLength(1);
    const f = m.target.querySelector('form')!;
    expect(f.method).toBe('get'); expect(f.hasAttribute('data-sveltekit-reload')).toBe(true);
    expect(f.querySelector<HTMLInputElement>('[name=status]')!.value).toBe('all');
    expect(f.querySelector<HTMLInputElement>('[name=view]')!.value).toBe('board');
    const ended = [...m.target.querySelectorAll('a')].find(a => a.textContent === 'Ended')!;
    const url = new URL(ended.href);
    expect(url.searchParams.get('text')).toBe('%_\\ &+');
    expect(url.searchParams.get('status')).toBe('ended');
    expect(ended.hasAttribute('data-sveltekit-reload')).toBe(true);
    const clear = [...m.target.querySelectorAll('a')].find(a => a.textContent === 'Clear')!;
    expect(new URL(clear.href).searchParams.has('text')).toBe(false);
    expect(new URL(clear.href).searchParams.get('status')).toBe('all');
  });
  it('trims before submit, keeps blank usable, and refuses over 200 UTF-16 units without truncating', async () => {
    const m = await mount();
    const f = m.target.querySelector('form')!;
    const input = f.querySelector<HTMLInputElement>('[name=text]')!;
    input.value = '  '+ '😀'.repeat(100)+'  ';
    expect(f.dispatchEvent(new Event('submit', { cancelable: true }))).toBe(true);
    expect(new FormData(f).get('text')).toBe('😀'.repeat(100));
    input.value += 'a';
    expect(f.dispatchEvent(new Event('submit', { cancelable: true }))).toBe(false);
    expect(input.value.length).toBe(201); expect(input.validationMessage).toContain('1 to 200');
    input.value = '  '; input.dispatchEvent(new Event('input'));
    expect(f.dispatchEvent(new Event('submit', { cancelable: true }))).toBe(true);
    expect(new FormData(f).get('text')).toBe('');
    expect(input.disabled).toBe(false);
  });
  it.each([{ text: 'new' }, { text: '' }, { filter: 'ended' }, { app: { id: 'app-2', name: 'Other', urn: 'hrn:app:acme.com:other', organizationId: null } }])('resets page position on search/clear/status/App navigation (%j)', async (next) => {
    const m = await mount();
    button(m, 'Next').click(); await tick(2);
    expect(m.target.textContent).toContain('Page 2 of 3');
    (m.instance.navigate as (next: unknown) => void)(data(next)); await tick(3);
    expect(m.target.textContent).toContain('Page 1 of 3');
    expect(m.target.querySelector<HTMLInputElement>('[name=text]')?.value).toBe(next.text ?? 'description-needle');
  });
  it('keeps page position for a refresh of the same slice', async () => {
    const m = await mount(); button(m, 'Next').click(); await tick(2);
    (m.instance.navigate as (next: unknown) => void)(data({ loadedAt: '2026-10-29T01:00:00Z' })); await tick(3);
    expect(m.target.textContent).toContain('Page 2 of 3');
  });
  it('does not apply a legacy saved local filter over server description matches', async () => {
    const saved = await localStorageViewStore.create('app-tasks:board', 'Legacy', { globalFilter: 'unmatchable-title' } as never);
    await localStorageViewStore.setDefault('app-tasks:board', saved.id);
    const m = await mount();
    // Open the table controls so ViewTabs restores the default view.
    const toggle = m.target.querySelector<HTMLButtonElement>('[aria-expanded]')!;
    toggle.click(); await tick(6);
    expect(m.target.textContent).toContain('Legacy');
    expect(m.target.querySelectorAll('tbody tr').length).toBeGreaterThan(0);
    expect(m.target.textContent).toContain('Task 0');
  });
  it('keeps no matches, guidance, failure and concealment distinct', async () => {
    const m = await mount({ board: { kind: 'ok', value: { tasks: [], capped: false } } });
    expect(m.target.textContent).toContain('No matching tasks.');
    expect(m.target.textContent).toContain('0 tasks shown');
    expect(m.target.textContent).not.toContain('There may be more');
    (m.instance.navigate as (next: unknown) => void)(data({ board: { kind: 'invalid-search' } })); await tick(2);
    expect(m.target.querySelector('[role=alert]')?.textContent).toContain('1 to 200');
    expect(m.target.textContent).not.toContain('No matching');
    (m.instance.navigate as (next: unknown) => void)(data({ board: { kind: 'failed' } })); await tick(2);
    expect(m.target.textContent).toContain('Couldn’t load tasks.');
    (m.instance.navigate as (next: unknown) => void)(data({ board: { kind: 'not-participant' } })); await tick(2);
    expect(m.target.textContent).toContain('You don’t take part'); expect(m.target.querySelector('form')).toBeNull();
  });
});
