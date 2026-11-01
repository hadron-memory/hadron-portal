import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import TaskPlanning from './TaskPlanning.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); localStorage.clear(); });
const choice = (id: string) => ({ id, appId: 'app', title: `Task ${id}`, handle: 'AT1.2', status: 'PENDING' });
async function setup(status = 'PENDING', canWrite = true, blocker = choice('blocker')) {
  const m = mountComponent(TaskPlanning as never, {
    task: { id: 'subject', appId: 'app', handle: 'AT1', status, priority: 3 }, appId: 'app', canWrite,
    dependencies: { kind: 'ok', value: {
      blockedBy: { items: [blocker], hasMore: false },
      blocks: { items: [choice('dependent')], hasMore: false },
    } },
  } as never);
  mounted.push(m); await tick(5); return m;
}
describe('phone relation action placement', () => {
  it('puts the unchanged Remove form first in each eligible row without replacing the grid', async () => {
    const m = await setup();
    const row = m.target.querySelector('tbody tr')!;
    expect(row.firstElementChild?.querySelector('form[action="?/removeBlocker"]')).not.toBeNull();
    expect(row.querySelector<HTMLInputElement>('input[name="blockerTaskRef"]')?.value).toBe('blocker');
    expect(row.querySelector('a')?.textContent).toBe('Task blocker');
    expect(m.target.querySelectorAll('form[action="?/removeBlocker"]')).toHaveLength(1);
    expect(m.target.querySelector('table')).not.toBeNull();
  });
  it.each([['Task blocker', 'Task blocker'], ['', 'AT1.2'], ['   ', 'AT1.2']])('names the blocker when its title is %j', async (title, name) => {
    const m = await setup('PENDING', true, { ...choice('blocker'), title });
    const button = m.target.querySelector('form[action="?/removeBlocker"] button');
    expect(button?.textContent).toBe('Remove');
    expect(button?.getAttribute('aria-label')).toBe(`Remove blocker ${name}`);
    expect(m.target.querySelector<HTMLInputElement>('input[name="blockerTaskRef"]')?.value).toBe('blocker');
  });
  it('keeps the action visible and leading when a legacy saved view hides it or puts it last', async () => {
    localStorage.setItem('hadron:views:v1:task-dependencies', JSON.stringify([{
      id: 'legacy', name: 'Old arrangement', isDefault: true, listKey: 'task-dependencies',
      view: { columnOrder: ['direction', 'title', 'handle', 'status', 'remove'], columnVisibility: { remove: false }, pagination: { pageIndex: 0, pageSize: 10 } },
    }]));
    const m = await setup();
    expect(m.target.querySelector('tbody tr')?.firstElementChild?.querySelector('form[action="?/removeBlocker"]')).not.toBeNull();
    expect(m.target.textContent).toContain('AT1.2');
  });
  it.each([['STARTED', true], ['FINISHED', true], ['CANCELLED', true], ['PENDING', false], ['BACKLOG', false]])('retains existing restrictions for %s / writable=%s', async (status, canWrite) => {
    const m = await setup(status as string, canWrite as boolean);
    expect(m.target.querySelector('form[action="?/removeBlocker"]')).toBeNull();
    expect(m.target.textContent).toContain('Task blocker');
  });
});
