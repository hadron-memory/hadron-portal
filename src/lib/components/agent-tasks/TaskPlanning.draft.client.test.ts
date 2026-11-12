/**
 * portal#1626 (#1392 follow-up): the unsent blocker-add draft (`chosen`) survives a successful
 * priority save or blocker removal; only a successful addBlocker clears its own draft. Mounted, with
 * the real picker and the real shared submit handler.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import TaskPlanning from './TaskPlanning.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });
const choice = (id: string) => ({ id, appId: 'app', title: `Task ${id}`, handle: `AT1.${id}`, status: 'PENDING' });
const dependencies = { kind: 'ok' as const, value: { blockedBy: { items: [choice('b1')], hasMore: false }, blocks: { items: [], hasMore: false } } };
const button = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;
const ok = { type: 'success' as const, status: 200, data: {} };
async function mount() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ kind: 'ok', value: { items: [choice('pick')], hasMore: false } }) }));
  const m = mountComponent(TaskPlanning as never, { task: { id: 'T', appId: 'app', status: 'PENDING', priority: 3 }, appId: 'app', canWrite: true, dependencies } as never);
  mounted.push(m); await tick(5);
  button(m.target, 'Choose a task').click(); await tick(8);
  button(m.target, 'Select').click(); await tick(5);
  expect(m.target.textContent).toContain('Waits for: Task pick');
  return m;
}
const hidden = (m: { target: HTMLElement }) => m.target.querySelector<HTMLInputElement>('form[action="?/addBlocker"] input[name="blockerTaskRef"]')!.value;

describe('the unsent blocker-add draft (portal#1626)', () => {
  it('a successful priority save keeps it', async () => {
    const m = await mount();
    await submitEnhancedWithResult(m.target.querySelector('form[action="?/priority"]')!, ok); await tick(8);
    expect(m.target.textContent).toContain('Waits for: Task pick');
    expect(hidden(m)).toBe('pick');
    expect(button(m.target, 'Add blocker').disabled).toBe(false);
  });
  it('a successful blocker removal keeps it', async () => {
    const m = await mount();
    await submitEnhancedWithResult(m.target.querySelector('form[action="?/removeBlocker"]')!, ok); await tick(8);
    expect(m.target.textContent).toContain('Waits for: Task pick');
    expect(hidden(m)).toBe('pick');
  });
  it('a successful addBlocker clears its own draft', async () => {
    const m = await mount();
    await submitEnhancedWithResult(m.target.querySelector('form[action="?/addBlocker"]')!, ok); await tick(8);
    expect(m.target.textContent).toContain('No task selected');
    expect(hidden(m)).toBe('');
    expect(button(m.target, 'Add blocker').disabled).toBe(true);
  });
  it('a refused addBlocker (cycle) keeps it', async () => {
    const m = await mount();
    await submitEnhancedWithResult(m.target.querySelector('form[action="?/addBlocker"]')!, { type: 'failure', status: 409, data: { refusal: { kind: 'refused', code: 'TASK_BLOCKER_CYCLE', message: 'That would make a cycle.' } } }); await tick(8);
    expect(m.target.textContent).toContain('Waits for: Task pick');
    expect(hidden(m)).toBe('pick');
  });
  it('a failed priority save keeps it', async () => {
    const m = await mount();
    await submitEnhancedWithResult(m.target.querySelector('form[action="?/priority"]')!, { type: 'failure', status: 403, data: { refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message: 'Not allowed.' } } }); await tick(8);
    expect(hidden(m)).toBe('pick');
  });
  it('after a priority save the kept draft can still be added, and then clears', async () => {
    const m = await mount();
    await submitEnhancedWithResult(m.target.querySelector('form[action="?/priority"]')!, ok); await tick(8);
    await submitEnhancedWithResult(m.target.querySelector('form[action="?/addBlocker"]')!, ok); await tick(8);
    expect(hidden(m)).toBe('');
  });
});
