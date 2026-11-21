/**
 * portal#2413: PartyLabel no longer clips around the Urn chip, so the Urn
 * itself must (a) truncate a long value without help from an ancestor, and
 * (b) keep the copy buttons OUTSIDE the one element that clips, or their focus
 * ring is cut there. jsdom has no layout, so this pins the structure that
 * decides both; the pixels are the browser leg's.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import Urn from './Urn.svelte';

const CLIP = /\boverflow(-[xy])?-(hidden|clip|auto|scroll)\b/;
const urn = 'hrn:worker:hadronmemory.com:hadron-dev-team:ada';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mountUrn(compact: boolean) {
  const m = mountComponent(Urn as never, { value: urn, compact } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick(2);
  return m.target.firstElementChild as HTMLElement;
}

describe.each([{ compact: true }, { compact: false }])('Urn copy buttons and truncation (compact=%j)', ({ compact }) => {
  const root = () => mountUrn(compact);

  it('the root does not clip and can shrink, so a long value never needs an ancestor clip', async () => {
    const cls = (await root()).getAttribute('class') ?? '';
    expect(cls).not.toMatch(CLIP);
    expect(cls).toContain('min-w-0');
    expect(cls).toContain('max-w-full');
  });
  it('the value text truncates inside the chip', async () => {
    const chip = (await root()).querySelector('code')!;
    expect(chip.getAttribute('class')).toMatch(CLIP);
    expect(chip.querySelector('.truncate'), 'a truncating value element').not.toBeNull();
  });
  it('the copy buttons sit outside every clipping element', async () => {
    const buttons = [...(await root()).querySelectorAll('button[aria-label^="Copy"]')];
    expect(buttons.length).toBe(2);
    for (const b of buttons) {
      for (let e: HTMLElement | null = b.parentElement; e; e = e.parentElement) {
        expect(e.getAttribute('class') ?? '', `ancestor of ${b.getAttribute('aria-label')}`).not.toMatch(CLIP);
      }
      expect(b.closest('code')).toBeNull();
    }
  });
});
