import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import TaskPlanning from './TaskPlanning.svelte';

const mounts: { unmount: () => void }[] = [];
afterEach(() => { mounts.splice(0).forEach((m) => m.unmount()); vi.unstubAllGlobals(); });
const choice = (id: string) => ({ id, appId: 'app', title: `Task ${id}`, handle: `AT1.${id}`, status: 'PENDING' });
const initial = () => ({ kind: 'ok' as const, value: {
  blockedBy: { items: [choice('old-wait')], hasMore: true },
  blocks: { items: [choice('old-hold')], hasMore: true },
} });
async function setup() {
  let resolve!: (r: Response) => void;
  vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise<Response>((r) => resolve = r)));
  const props = reactiveProps({ task: { id: 'task', appId: 'app', handle: 'AT1', status: 'PENDING', priority: 3 }, appId: 'app', canWrite: true, dependencies: initial() });
  const m = mountComponent(TaskPlanning as never, props as never); mounts.push(m); await tick(3);
  const filter = m.target.querySelector<HTMLInputElement>('input[aria-label="Filter loaded relations…"]')!;
  const more = (name: string) => Array.from(m.target.querySelectorAll('button')).find((b) => b.textContent === name)!;
  return { ...m, props, filter, more, settle: (hasMore = false) => resolve({ ok: true, json: async () => ({ kind: 'ok', value: { items: [choice('new')], hasMore } }) } as Response) };
}
// jsdom does not synthesize native button activation from a key. Dispatch the key
// and its resulting click here; the real Chromium lane drives Enter/Space itself.
function activate(button: HTMLButtonElement, key: string) {
  button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  button.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true })); button.click();
}

describe('exhausted relation control focus', () => {
  it.each(['Load more Waits for', 'Load more Holds up'].flatMap((name) => ['Enter', ' '].map((key) => [name, key])))('%s %s hands focus to the surviving filter after appending and exhausting', async (name, key) => {
    const m = await setup(); const trigger = m.more(name); activate(trigger, key); await tick(3);
    m.settle(); await tick(12);
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).toBe(m.filter);
    for (const title of ['Task old-wait', 'Task old-hold', 'Task new']) expect(m.target.textContent).toContain(title);
  });
  it('preserves a newer focus, even if that newer target is subsequently blurred to body', async () => {
    const m = await setup(); activate(m.more('Load more Waits for'), 'Enter'); await tick(3);
    const newer = m.more('Choose a task'); newer.focus(); newer.blur();
    m.settle(); await tick(12);
    expect(document.activeElement).toBe(document.body);
    expect(m.target.textContent).toContain('Task new');
  });
  it('keeps a newer surviving control focused while the final page arrives', async () => {
    const m = await setup(); activate(m.more('Load more Holds up'), ' '); await tick(3);
    const newer = m.more('Choose a task'); newer.focus(); m.settle(); await tick(12);
    expect(document.activeElement).toBe(newer);
    expect(m.target.textContent).toContain('Task new');
  });
  it('does not hand focus off on a short non-final page', async () => {
    const m = await setup(); const trigger = m.more('Load more Waits for'); activate(trigger, 'Enter'); await tick(3);
    m.settle(true); await tick(12);
    expect(trigger.isConnected).toBe(true); expect(document.activeElement).not.toBe(m.filter);
    expect(m.target.textContent).toContain('Task new');
  });
  it('does not focus a new task after a pending page is invalidated', async () => {
    const m = await setup(); activate(m.more('Load more Waits for'), 'Enter'); await tick(3);
    m.props.task = { ...m.props.task, id: 'B' }; m.props.dependencies = initial(); await tick(3);
    const newer = m.more('Choose a task'); newer.focus(); m.settle(); await tick(12);
    expect(document.activeElement).toBe(newer); expect(m.target.textContent).not.toContain('Task new');
  });
  it('does not run a pending focus handoff after unmount', async () => {
    const m = await setup(); activate(m.more('Load more Waits for'), 'Enter'); await tick(3); m.unmount();
    m.settle(); await tick(12); expect(document.activeElement).toBe(document.body);
  });
});
