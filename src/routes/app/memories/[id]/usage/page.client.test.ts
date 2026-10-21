/**
 * portal#1226 — the Usage tab's table pane says when its 200-event window came
 * back full, on the real page, and says nothing otherwise.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import Page from './+page.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });

async function mountUsage(over: Record<string, unknown>) {
  setStubPage('https://example.test/app/memories/m1/usage', { id: 'm1' });
  const m = mountComponent(Page as never, {
    data: { graph: { id: 'm1', name: 'Docs', urn: 'hrn:mem:acme.com:docs' }, events: [], ...over },
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(3);
  return m.target;
}

describe('Usage tab full-window cue (#1226)', () => {
  it('says the first N events are shown when the window was full', async () => {
    const events = Array.from({ length: 200 }, (_, i) => ({ id: `e${i}`, type: 'read', nodeLoc: 'a', createdAt: '2026-10-01T00:00:00Z' }));
    expect((await mountUsage({ events, eventsCapped: true })).textContent).toContain('Showing the first 200 usage events');
  });

  it('says nothing for a window that was not full', async () => {
    expect((await mountUsage({ eventsCapped: false })).textContent).not.toContain('Showing the first');
  });
});
