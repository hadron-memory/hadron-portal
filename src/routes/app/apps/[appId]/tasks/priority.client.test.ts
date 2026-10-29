import { afterEach, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import Board from './+page.svelte';
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(), goto: vi.fn(), beforeNavigate: () => {} }));
const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
it('sorts unknown priority after known priorities in both directions', async () => {
  const owner = { id: 'u1', kind: 'USER', name: 'Owner', urn: null };
  const tasks = [null, 3, 1].map((priority, i) => ({ id: `t${i}`, title: ['Unknown', 'Medium', 'Highest'][i], priority,
    status: 'BACKLOG', queued: false, waitingOnChildren: false, source: null, parentTaskId: null,
    owner, assignee: null, startBy: null, createdAt: '2026-10-15T10:00:00Z', updatedAt: null, tags: [] }));
  const m = mountComponent(Board, { data: { app: { id: 'app', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null },
    filter: 'active', boardLimit: 200, loadedAt: '2026-10-16T01:00:00Z', impersonating: null,
    board: { kind: 'ok', value: { tasks, capped: false } } } } as never);
  mounted.push(m); await tick(5);
  const priority = [...m.target.querySelectorAll<HTMLElement>('th')].find(b => b.textContent?.includes('Priority'))!;
  expect(priority).toBeTruthy();
  const order = () => [...m.target.querySelectorAll('tbody tr')].map(row => tasks.find(task => row.textContent?.includes(task.title))?.title);
  priority.click(); await tick(5);
  expect(order()).toEqual(['Highest', 'Medium', 'Unknown']);
  priority.click(); await tick(5);
  expect(order()).toEqual(['Medium', 'Highest', 'Unknown']);
});
