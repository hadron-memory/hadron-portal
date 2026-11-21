/**
 * portal#2413: nothing between PartyLabel's root and the Urn chip may clip
 * overflow, or it cuts the copy buttons' focus ring at its edge. jsdom has no
 * layout, so this pins the structural cause (a clipping ancestor), not pixels:
 * the chip truncates itself, so the ancestors need no clip. Measured in real
 * Chromium on the PR: a padded clip (p-1/-m-1) costs the chip 8px of width;
 * no clip at all lays out exactly as before.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PartyLabel from './PartyLabel.svelte';

const worker = { kind: 'WORKER', id: 'w1', name: 'Ada', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:ada' };
const CLIP = /\boverflow(-[xy])?-(hidden|clip|auto|scroll)\b/;

describe('PartyLabel URN wrapper', () => {
  it('has no clipping ancestor above the Urn chip', () => {
    const { body } = render(PartyLabel, { props: { party: worker as never } });
    const urnAt = body.indexOf('inline-flex min-w-0 max-w-full items-center gap-1');
    expect(urnAt, 'the Urn chip is rendered').toBeGreaterThan(0);
    const ancestors = [...body.slice(0, urnAt).matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
    expect(ancestors.length).toBeGreaterThanOrEqual(2);
    for (const cls of ancestors) expect(cls, `ancestor class "${cls}"`).not.toMatch(CLIP);
  });
  it('the detector sees a clip when one is present', () => {
    expect('block max-w-full min-w-0 overflow-hidden').toMatch(CLIP);
    expect('block max-w-full min-w-0 -m-1 p-1 overflow-clip').toMatch(CLIP);
    expect('block max-w-full min-w-0').not.toMatch(CLIP);
  });
});
