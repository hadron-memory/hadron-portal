/**
 * portal#2523: PartyLabel clamps a long name to one line, so the full name must
 * stay reachable through a `title` — on the person branch as on the worker one.
 * Server render: the title is static markup, no lifecycle involved.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PartyLabel from './PartyLabel.svelte';

const long = 'Alexandria Montgomery-Featherstonehaugh the Third';
const html = (party: unknown) => render(PartyLabel as never, { props: { party } }).body;

describe('PartyLabel name title', () => {
  it('a person carries the full name as the clamped span title', () => {
    const body = html({ kind: 'USER', id: 'u1', name: long });
    expect(body).toMatch(new RegExp(`<span[^>]*line-clamp-1[^>]*title="${long}"`));
  });
  it('a nameless person falls back to the id in the title', () => {
    expect(html({ kind: 'USER', id: 'u2', name: ' ' })).toMatch(/line-clamp-1[^>]*title="u2"/);
  });
  it('a worker carries the title on its link', () => {
    const body = html({ kind: 'WORKER', id: 'w1', name: long, urn: null });
    expect(body).toMatch(new RegExp(`<a[^>]*title="${long}"`));
  });
});
