/**
 * portal#2487: the Roster's Last active and Last assigned cells hold a full date and time
 * ("Nov 21, 2026, 14:03:22") in 170px columns. A nowrap span cannot break, so it painted past
 * its cell; the cell wraps at its spaces instead. The Chromium harness measures the layout, with
 * every column shown (Last assigned is hidden by default, so only the harness reaches it).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent } from '$lib/test/mountComponent';
import TasksRoster from './TasksRoster.svelte';

const at = '2026-11-01T02:04:36Z';
const entry = (over: Record<string, unknown>) => ({
  worker: { id: 'w1', kind: 'WORKER' as const, name: 'Ada', urn: 'hrn:worker:acme.com:team:ada' },
  role: 'portal-engineer', state: 'WORKING', family: 'claude', freeFamilies: [], launchableFamilies: [], unavailableFamilies: [],
  unavailableReason: null, unavailableUntil: null, bound: true, liveSession: true, lastActiveAt: null, lastAssignedAt: null,
  reportsTo: null, reportsToRetired: false, startedTasks: [], pendingTasks: [], waitingOn: [], waitingSince: null, unreactedChildTask: null, alarms: [], ...over,
});
const mount = (over: Record<string, unknown>) =>
  mountComponent(TasksRoster, { roster: { kind: 'ok' as const, value: { asOf: at, workers: [entry(over)] } }, refs: {}, basePath: '/app/apps/app-1', impersonating: null });
const cellOf = (target: HTMLElement, header: string) => {
  const heads = [...target.querySelectorAll('thead th')].map((th) => th.textContent?.trim());
  const index = heads.findIndex((h) => h?.startsWith(header));
  expect(index, `${header} column is shown`).toBeGreaterThanOrEqual(0);
  return target.querySelectorAll('tbody tr')[0].querySelectorAll('td')[index];
};

afterEach(() => { document.body.innerHTML = ''; });

describe('portal#2487 Roster timestamps wrap instead of overflowing', () => {
  it.each([['Last active', { lastActiveAt: at }]] as const)('%s has no nowrap element', (header, over) => {
    const { target, unmount } = mount(over);
    const cell = cellOf(target, header);
    expect(cell.textContent).toMatch(/2026/);
    expect(cell.querySelector('.whitespace-nowrap')).toBeNull();
    unmount();
  });
  it('control: an empty timestamp still renders the dash', () => {
    const { target, unmount } = mount({});
    expect(cellOf(target, 'Last active').textContent?.trim()).toBe('—');
    unmount();
  });
});
