import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { firstPaint } from '$lib/test/firstPaint';
import { idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
import Panel from './InstallCustomisation.svelte';

/**
 * portal#2344 / #2377 slice 4: the three 'Loading…' lines (list, original, replacement) are announced by
 * persistent LiveRegions. Each pin: the region exists, empty, before the read; holds the text during; is the
 * SAME element, empty again, after.
 */
const mounted: ReturnType<typeof mountComponent>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  vi.unstubAllGlobals();
});
const agent = { id: 'ag-a', name: 'Sample Agent', urn: 'hrn:agent:acme.com:sample' };
const node = { id: 'n1', loc: 'note', name: 'Note', content: 'original draft', revision: 7 };
const answer = {
  list: { state: 'ok', value: { memoryId: 'mem', urn: 'hrn:mem:acme.com:install', nodes: [node], total: 1, offset: 0 } },
  replacement: { state: 'ok', value: node },
  original: { state: 'ok', value: { ...node, content: 'base text' } },
};
const json = () => new Response(JSON.stringify(answer), { headers: { 'Content-Type': 'application/json' } });
async function settle() {
  await new Promise((r) => setTimeout(r, 0));
  await tick(4);
}
const loadingRegions = (root: HTMLElement) =>
  [...root.querySelectorAll<HTMLElement>('[role="status"]')].filter((r) => r.textContent?.trim() === 'Loading…');

describe('InstallCustomisation loading lines are persistent live regions (#2377)', () => {
  it('list: the region is loading at mount, and is the same element once the list lands', async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { resolve = r; })));
    const m = mountComponent(Panel, { appRef: 'app-a', agent, canManage: true });
    mounted.push(m);
    await tick(4);
    // The list read starts at mount: the region is inserted empty and fills after the first paint (#2388).
    const first = [...m.target.querySelectorAll('[role="status"]')];
    await firstPaint();
    const during = loadingRegions(m.target);
    expect(during).toHaveLength(1);
    expect(first).toContain(during[0]);
    resolve(json());
    await settle();
    expect(during[0].isConnected).toBe(true);
    expect(during[0].textContent?.trim()).toBe('');
    expect(loadingRegions(m.target)).toHaveLength(0);
  });

  const open = (root: HTMLElement, text: string) =>
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!.click();
  const deferred = () => {
    let resolve!: (r: Response) => void;
    vi.mocked(fetch).mockImplementationOnce(() => new Promise<Response>((r) => { resolve = r; }));
    return () => resolve(json());
  };

  it('original and replacement: the regions mount with the opened customisation, and keep their identity when the read lands', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json()));
    const m = mountComponent(Panel, { appRef: 'app-a', agent, canManage: true });
    mounted.push(m);
    await settle();
    const root = m.target;
    const answerRead = deferred();
    open(root, 'Open');
    await tick(4);
    // The Original/Replacement grid only exists once a customisation is open (`{#if loc}`), so on the
    // FIRST Open these regions are inserted by the Open itself: they fill after the first paint (#2388),
    // and the same elements are what is left empty when the read lands.
    await firstPaint();
    const during = loadingRegions(root);
    expect(during).toHaveLength(3); // list + original + replacement
    answerRead();
    await settle();
    for (const r of during) {
      expect(r.isConnected).toBe(true);
      expect(r.textContent?.trim()).toBe('');
    }
  });

  it('original and replacement: on a reload the regions are empty before, loading during, the same elements after', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json()));
    const m = mountComponent(Panel, { appRef: 'app-a', agent, canManage: true });
    mounted.push(m);
    await settle();
    const root = m.target;
    open(root, 'Open');
    await settle();
    const idle = idleStatusRegions(root);
    expect(loadingRegions(root)).toHaveLength(0);
    const answerRead = deferred();
    open(root, 'Reload and discard draft');
    await tick(4);
    await firstPaint();
    const during = loadingRegions(root);
    expect(during).toHaveLength(3);
    for (const r of during) expect(idle, 'each region existed, empty, before the reload').toContain(r);
    answerRead();
    await settle();
    for (const r of during) {
      expect(r.isConnected).toBe(true);
      expect(r.textContent?.trim()).toBe('');
    }
    expect(loadingRegions(root)).toHaveLength(0);
  });
});
