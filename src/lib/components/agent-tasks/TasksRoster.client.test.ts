/**
 * portal#1349 — the Roster's search reaches the tasks its Detail cell names by
 * handle as well as by title, like the Alarms and the AI Team grid (Dorian's
 * BLIND P3 on #1375). A server render never types, so this is the client lane.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import TasksRoster from './TasksRoster.svelte';

const entry = (name: string, startedTasks: string[]) => ({
  worker: { id: name, kind: 'WORKER' as const, name, urn: `hrn:worker:acme.com:team:${name}` },
  role: 'portal-engineer', state: 'WORKING', family: 'claude', freeFamilies: [], launchableFamilies: [], unavailableFamilies: [],
  unavailableReason: null, unavailableUntil: null, bound: true, liveSession: true, lastActiveAt: null, lastAssignedAt: null,
  reportsTo: null, reportsToRetired: false, startedTasks, pendingTasks: [], waitingOn: [], waitingSince: null, unreactedChildTask: null, alarms: [],
});
const roster = { kind: 'ok' as const, value: { asOf: '2026-10-29T00:00:00Z', workers: [entry('Gaia', ['t1']), entry('Gene', ['t2'])] } };
const refs = {
  t1: { id: 't1', handle: 'AT3.405', title: 'Ship handles' },
  t2: { id: 't2', handle: 'AT7', title: 'Review it' },
};

afterEach(() => {
  document.body.innerHTML = '';
});

async function search(target: HTMLElement, text: string) {
  const input = target.querySelector<HTMLInputElement>('input[aria-label="Search the roster…"]')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await tick(2);
}

describe('TasksRoster search', () => {
  it('a handle finds the worker whose Detail names that task, and only that worker', async () => {
    const { target, unmount } = mountComponent(TasksRoster, { roster, refs, basePath: '/app/apps/app-1', impersonating: null });
    await search(target, 'AT3.405');
    expect(target.textContent).toContain('Gaia');
    expect(target.textContent).not.toContain('Gene');
    unmount();
  });

  it('an unavailable reference contributes no handle, stale or otherwise', async () => {
    const { target, unmount } = mountComponent(TasksRoster, { roster, refs: { ...refs, t1: null }, basePath: '/app/apps/app-1', impersonating: null });
    await search(target, 'AT3.405');
    expect(target.textContent).not.toContain('Gaia');
    unmount();
  });
});
