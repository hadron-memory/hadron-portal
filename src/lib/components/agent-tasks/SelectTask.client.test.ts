import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import SelectTask from './SelectTask.svelte';
const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });
const choice = (id = 't1', appId = 'app') => ({ id, appId, title: `Title ${id}`, handle: 'AT1.2', status: 'PENDING' });
const answer = (items: unknown[], hasMore = false) => ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore } }) });
const button = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;
async function mount() { const m = mountComponent(SelectTask, { appId: 'app', open: true, onselect: vi.fn() }); mounted.push(m); await tick(5); return m; }
describe('SelectTask real mounted async picker', () => {
  it('loads beyond 200 and labels filtering as loaded-only', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer(Array.from({ length: 200 }, (_, i) => choice(String(i))), true)).mockResolvedValueOnce(answer([choice('201')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount();
    expect(m.target.textContent).toContain('Search filters loaded pages only');
    button(m.target, 'Load more tasks').click(); await tick(5);
    expect(fetch.mock.calls[1][0]).toContain('offset=200');
    expect(button(m.target, 'Load more tasks')).toBeUndefined();
  });
  it('does not expose a foreign exact response or offer a selection from it', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer([choice('old')])).mockResolvedValueOnce(answer([choice('foreign', 'another')]));
    vi.stubGlobal('fetch', fetch); const m = await mount();
    const input = m.target.querySelector<HTMLInputElement>('input')!;
    input.value = 'AT2.3'; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
    button(m.target, 'Look up').click(); await tick(5);
    expect(m.target.textContent).not.toContain('Title foreign');
    expect(m.target.textContent).not.toContain('Title old');
    expect(m.target.textContent).toContain('Couldn’t load tasks');
  });
  it('drops a pending response after unmount', async () => {
    let finish!: (value: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    const m = await mount(); m.unmount(); finish(answer([choice()])); await tick(5);
    expect(m.target.textContent).not.toContain('Title t1');
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });
  it('reports repeated pages instead of claiming the list complete', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(answer([choice()], true)).mockResolvedValueOnce(answer([choice()], true)));
    const m = await mount(); button(m.target, 'Load more tasks').click(); await tick(5);
    expect(m.target.textContent).toContain('Some tasks may be missing');
    expect(button(m.target, 'Load more tasks')).toBeUndefined();
  });
});
