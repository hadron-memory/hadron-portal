import { afterEach, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { page, resetStubPage } from '$lib/test/stubs/app-stores';
import Harness from '$lib/test/fixtures/memory-browser-group-harness.svelte';

// portal#1433 lifecycle pin. The `(browser)` group exists so Nodes <-> Graph
// keeps ONE mounted MemoryBrowser, and so the node-detail route mounts none.
// Both directions are pinned: a browser that remounted on a tab switch, and a
// node page that still carried one, each fail here.
let m: Mounted<Record<string, never>> | undefined;
afterEach(() => { m?.unmount(); m = undefined; resetStubPage(); vi.unstubAllGlobals(); });

function route(id: string) {
  page.update((p) => ({ ...p, route: { id }, url: new URL('http://localhost' + id.replace('(browser)/', '').replace('[id]', 'mem-a')) }));
  flushSync();
}
// A control only MemoryBrowser renders; its element identity survives iff the
// component instance does.
const marker = () => [...m!.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim().startsWith('Properties')) ?? null;

it('keeps ONE mounted MemoryBrowser across Nodes <-> Graph, mounts none on a node page, and a fresh one on return', () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nodes: [], total: 0 }))));
  route('/app/memories/[id]/(browser)/nodes');
  m = mountComponent(Harness, {});
  const first = marker();
  expect(first).not.toBeNull();

  for (const tab of ['graph', 'nodes', 'graph']) {
    route('/app/memories/[id]/(browser)/' + tab);
    // Graph view may hide the Properties control; the guard is the instance, so
    // compare only when the control is rendered on both sides.
    const now = marker();
    if (now) expect(now).toBe(first);
  }
  route('/app/memories/[id]/(browser)/nodes');
  expect(marker()).toBe(first);

  route('/app/memories/[id]/nodes/[nodeId]');
  expect(marker()).toBeNull();
  expect(m.target.querySelector('[data-testid="outside-group"]')).not.toBeNull();

  route('/app/memories/[id]/(browser)/nodes');
  const again = marker();
  expect(again).not.toBeNull();
  expect(again).not.toBe(first); // R3: returning re-mounts (and re-drains)
});

it.each(['/app/memories/[id]/info', '/app/memories/[id]/settings', '/app/memories/[id]/assets', '/app/memories/[id]/nodes/new'])(
  '%s mounts no MemoryBrowser',
  (id) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ nodes: [], total: 0 }))));
    route(id);
    m = mountComponent(Harness, {});
    expect(marker()).toBeNull();
  },
);
