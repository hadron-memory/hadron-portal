/**
 * portal#2413: the wrapper that clips a long URN must leave room for the copy
 * buttons' focus ring, or an overflow-hidden ancestor cuts the ring's edge.
 * jsdom has no layout, so this pins the structural guard: any wrapper that
 * clips the Urn chip also pads (and un-pads with a negative margin).
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PartyLabel from './PartyLabel.svelte';

const worker = { kind: 'WORKER', id: 'w1', name: 'Ada', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:ada' };

describe('PartyLabel URN wrapper', () => {
  it('pads the clipping wrapper so the copy buttons keep a full focus ring', () => {
    const { body } = render(PartyLabel, { props: { party: worker as never } });
    const wrapper = body.match(/<span class="([^"]*overflow-hidden[^"]*)"><span class="inline-flex[^"]*">/);
    expect(wrapper, 'the clipping wrapper around the Urn chip').not.toBeNull();
    const cls = wrapper![1].split(/\s+/);
    expect(cls).toContain('p-1');
    expect(cls).toContain('-m-1');
  });
  it('renders no URN wrapper when showUrn is off', () => {
    const { body } = render(PartyLabel, { props: { party: worker as never, showUrn: false } });
    expect(body).not.toContain('overflow-hidden');
  });
});
