import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { submitEnhancedDeferred, submitEnhanced, submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import TaskPlanning from './TaskPlanning.svelte';
const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
async function mount(status = 'PENDING', canWrite = true) {
  const task = { id: 't1', appId: 'app', status, priority: 3 };
  const m = mountComponent(TaskPlanning as never, { task, appId: 'app', canWrite, dependencies: { kind: 'failed' } } as never);
  mounted.push(m); await tick(3); return m;
}
describe('TaskPlanning mounted controls and refusal preservation', () => {
  it.each(['FINISHED', 'CANCELLED'])('offers no priority or blocker writes on %s', async (status) => {
    const m = await mount(status); expect(m.target.querySelector('form')).toBeNull();
  });
  it('offers priority but no blocker edits on STARTED', async () => {
    const m = await mount('STARTED'); expect(m.target.querySelector('form[action="?/priority"]')).not.toBeNull();
    expect(m.target.querySelector('form[action="?/addBlocker"]')).toBeNull();
  });
  it('offers no writes under impersonation but retains the facts', async () => {
    const m = await mount('PENDING', false); expect(m.target.querySelector('form')).toBeNull();
    expect(m.target.textContent).toContain('Priority: 3'); expect(m.target.textContent).toContain('relations are unavailable');
  });
  it('keeps a refused priority draft and blocks a second submit while pending', async () => {
    const m = await mount(); const select = m.target.querySelector('select')!;
    select.value = '5'; select.dispatchEvent(new Event('change', { bubbles: true })); await tick();
    const form = m.target.querySelector<HTMLFormElement>('form[action="?/priority"]')!;
    await submitEnhancedWithResult(form, { type: 'failure', status: 403, data: { refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message: 'Not allowed.' } } }); await tick();
    expect(select.value).toBe('5'); expect(m.target.textContent).toContain('Not changed');
    expect((await submitEnhanced(form)).cancelled).toBe(false); await tick();
    expect((await submitEnhanced(form)).cancelled).toBe(true);
  });
  it('keeps uncertain results distinct from a refusal', async () => {
    const m = await mount(); const form = m.target.querySelector<HTMLFormElement>('form')!;
    await submitEnhancedWithResult(form, { type: 'failure', status: 502, data: { refusal: { kind: 'uncertain' } } }); await tick();
    expect(m.target.textContent).toContain('may or may not have gone through');
    expect(m.target.textContent).not.toContain('Not changed');
  });
  it('discards an old response after A → B → A and leaves a new pending submit locked', async () => {
    const a = { id: 'A', appId: 'app', status: 'PENDING', priority: 3 };
    const props = reactiveProps({ task: a, appId: 'app', canWrite: true, dependencies: { kind: 'failed' } });
    const m = mountComponent(TaskPlanning as never, props as never); mounted.push(m); await tick(3);
    const old = await submitEnhancedDeferred(m.target.querySelector('form')!);
    props.task = { ...a, id: 'B' }; await tick(3);
    props.task = a; await tick(3);
    const form = m.target.querySelector<HTMLFormElement>('form')!;
    await submitEnhancedDeferred(form); await tick();
    await old.finish({ type: 'failure', status: 403, data: { refusal: { kind: 'refused', code: 'TASK_NOT_OWNER', message: 'Old response' } } }); await tick();
    expect(m.target.textContent).not.toContain('Old response');
    expect((await submitEnhanced(form)).cancelled).toBe(true);
  });

  it('never offers planning edits for the platform-owned AT0 project', async () => {
    const m = mountComponent(TaskPlanning as never, { task: { id: 'zero', handle: 'AT0', status: 'BACKLOG', priority: 1 }, appId: 'app', canWrite: true, dependencies: { kind: 'failed' } } as never);
    mounted.push(m); await tick(3); expect(m.target.querySelector('form')).toBeNull();
  });

});
