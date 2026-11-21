/**
 * portal#2413: nothing between PartyLabel's root and the Urn chip may clip
 * overflow, or it cuts the copy buttons' focus ring at its edge. Walks the real
 * ancestors of the Copy buttons (a sibling's `truncate`, like the name link's,
 * is not an ancestor). jsdom has no layout, so this pins the structural cause;
 * Urn.focus-ring.client.test.ts pins the chip's own side.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { clipsOverflow } from '$lib/test/clipsOverflow';
import PartyLabel from './PartyLabel.svelte';

const worker = { kind: 'WORKER', id: 'w1', name: 'Ada', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:ada' };
const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mount() {
  const m = mountComponent(PartyLabel as never, { party: worker } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('PartyLabel URN wrapper', () => {
  it('no ancestor of a Copy button, up to the PartyLabel root, clips overflow', async () => {
    const target = await mount();
    const root = target.firstElementChild as HTMLElement;
    const buttons = [...target.querySelectorAll('button[aria-label^="Copy"]')];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      let depth = 0;
      for (let e: HTMLElement | null = b.parentElement; e; e = e.parentElement) {
        depth++;
        expect(clipsOverflow(e.getAttribute('class')), `ancestor "${e.getAttribute('class')}"`).toBe(false);
        if (e === root) break;
      }
      expect(depth, 'reached the PartyLabel root').toBeGreaterThanOrEqual(3);
    }
  });
});
