/**
 * portal#1626 (#1392 follow-up): Retry repeats the request that FAILED, not whatever the exact
 * input holds when it is clicked. Mounted, with the real picker.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import SelectTask from './SelectTask.svelte';

const mounted: { unmount: () => void }[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.unstubAllGlobals(); });
const choice = (id: string, appId = 'app') => ({ id, appId, title: `Title ${id}`, handle: 'AT1.2', status: 'PENDING' });
const answer = (items: unknown[], hasMore = false) => ({ ok: true, json: async () => ({ kind: 'ok', value: { items, hasMore } }) });
const down = { ok: false, json: async () => ({}) };
const button = (root: HTMLElement, label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;
const urls = (fetch: ReturnType<typeof vi.fn>) => fetch.mock.calls.map((c) => String(c[0]));
async function type(root: HTMLElement, value: string) {
  const input = root.querySelector<HTMLInputElement>('input')!;
  input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); await tick();
}
async function mount(props: Record<string, unknown> = {}) {
  const m = mountComponent(SelectTask as never, { appId: 'app', open: true, onselect: vi.fn(), ...props } as never);
  mounted.push(m); await tick(5); return m;
}

describe('picker Retry repeats the failed request (portal#1626)', () => {
  it('a failed first page retried after typing in the exact input is still that page, not an exact lookup', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(down).mockResolvedValueOnce(answer([choice('t1')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount();
    expect(m.target.textContent).toContain('Couldn’t load tasks');
    await type(m.target, 'AT9.9');
    button(m.target, 'Try again').click(); await tick(5);
    expect(urls(fetch)).toEqual(['/app/apps/app/tasks/choices?offset=0', '/app/apps/app/tasks/choices?offset=0']);
    expect(m.target.textContent).toContain('Title t1');
  });
  it('a failed later page keeps its offset when the input is edited', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer([choice('a'), choice('b')], true)).mockResolvedValueOnce(down).mockResolvedValueOnce(answer([choice('c')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount();
    button(m.target, 'Load more tasks').click(); await tick(5);
    await type(m.target, 'anything');
    button(m.target, 'Try again').click(); await tick(5);
    expect(urls(fetch)[1]).toBe('/app/apps/app/tasks/choices?offset=2');
    expect(urls(fetch)[2]).toBe('/app/apps/app/tasks/choices?offset=2');
    expect(m.target.textContent).toContain('Title c');
  });
  it('a failed exact lookup retried with the input CLEARED is still that exact lookup', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer([choice('old')])).mockResolvedValueOnce(down).mockResolvedValueOnce(answer([choice('AT2.3')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount();
    await type(m.target, 'AT2.3');
    button(m.target, 'Look up').click(); await tick(5);
    await type(m.target, '');
    button(m.target, 'Try again').click(); await tick(5);
    expect(urls(fetch)[1]).toContain('exact=AT2.3');
    expect(urls(fetch)[2]).toContain('exact=AT2.3');
    expect(m.target.textContent).toContain('Title AT2.3');
  });
  it('a failed exact lookup retried with a DIFFERENT input is still the original ref', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer([choice('old')])).mockResolvedValueOnce(down).mockResolvedValueOnce(answer([choice('AT2.3')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount();
    await type(m.target, 'AT2.3');
    button(m.target, 'Look up').click(); await tick(5);
    await type(m.target, 'AT7.7');
    button(m.target, 'Try again').click(); await tick(5);
    expect(urls(fetch)[2]).toContain('exact=AT2.3');
    expect(urls(fetch)[2]).not.toContain('AT7.7');
  });
  it('the ended flag is kept on the retried request', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(down).mockResolvedValueOnce(answer([choice('t1')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount({ includeEnded: true });
    await type(m.target, 'x');
    button(m.target, 'Try again').click(); await tick(5);
    expect(urls(fetch)[1]).toBe('/app/apps/app/tasks/choices?offset=0&ended=1');
  });
  it('a retry that fails again repeats the same request again', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer([choice('old')])).mockResolvedValueOnce(down).mockResolvedValueOnce(down).mockResolvedValueOnce(answer([choice('AT2.3')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount();
    await type(m.target, 'AT2.3');
    button(m.target, 'Look up').click(); await tick(5);
    await type(m.target, 'zzz');
    button(m.target, 'Try again').click(); await tick(5);
    button(m.target, 'Try again').click(); await tick(5);
    expect(urls(fetch).slice(1).every((u) => u.includes('exact=AT2.3'))).toBe(true);
  });
  it('a new failure replaces the old one: the retry is the LATEST failed request', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(answer([choice('a')], true)).mockResolvedValueOnce(down) // load more fails (page, offset 1)
      .mockResolvedValueOnce(answer([choice('AT2.3')])) // retry succeeds
      .mockResolvedValueOnce(down) // an exact lookup then fails
      .mockResolvedValueOnce(answer([choice('AT5.5')]));
    vi.stubGlobal('fetch', fetch);
    const m = await mount();
    button(m.target, 'Load more tasks').click(); await tick(5);
    button(m.target, 'Try again').click(); await tick(5);
    await type(m.target, 'AT5.5');
    button(m.target, 'Look up').click(); await tick(5);
    await type(m.target, '');
    button(m.target, 'Try again').click(); await tick(5);
    expect(urls(fetch)[4]).toContain('exact=AT5.5');
  });
  it('closing and reopening, or another App, drops the failed request: no stale Retry replays', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(answer([choice('old')])).mockResolvedValueOnce(down).mockResolvedValueOnce(down).mockResolvedValueOnce(answer([choice('x', 'other')]));
    vi.stubGlobal('fetch', fetch);
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app', open: true, onselect: vi.fn() });
    const m = mountComponent(SelectTask as never, props as never); mounted.push(m); await tick(5);
    await type(m.target, 'AT2.3');
    button(m.target, 'Look up').click(); await tick(5);
    props.appId = 'other'; await tick(5);
    // The other App's first page fails: its Retry must be ITS page read, not the old App's exact lookup.
    await type(m.target, '');
    button(m.target, 'Try again').click(); await tick(5);
    expect(urls(fetch)[2]).toBe('/app/apps/other/tasks/choices?offset=0');
    expect(urls(fetch)[3]).toBe('/app/apps/other/tasks/choices?offset=0');
  });
  it('a late response from before an App change cannot set the retry for the new App', async () => {
    const finishes: Array<(value: unknown) => void> = [];
    const fetch = vi.fn((_url: string) => new Promise((resolve) => { finishes.push(resolve); }));
    vi.stubGlobal('fetch', fetch);
    const props = reactiveProps<Record<string, unknown>>({ appId: 'app', open: true, onselect: vi.fn() });
    const m = mountComponent(SelectTask as never, props as never); mounted.push(m); await tick(5);
    props.appId = 'other'; await tick(5);
    finishes[0](down); await tick(5); // the OLD App's failure arrives late
    expect(m.target.textContent).not.toContain('Couldn’t load tasks');
    finishes[1](down); await tick(5); // the new App's own failure
    button(m.target, 'Try again').click(); await tick(5);
    expect(String(fetch.mock.calls[2][0])).toBe('/app/apps/other/tasks/choices?offset=0');
  });
});
