/**
 * portal#2523: PartyLabel clamps a long name to one line, so the full name must
 * stay reachable through a `title` — on the person branch as on the worker one.
 * Server render: the title is static markup, no lifecycle involved.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PartyLabel from './PartyLabel.svelte';
import type { AgentTaskParty } from '$lib/agent-tasks/types';

const long = 'Alexandria Montgomery-Featherstonehaugh the Third';
const urn = 'hrn:worker:hadronmemory.com:hadron-dev-team:ada';
const html = (party: AgentTaskParty) => render(PartyLabel, { props: { party } }).body;

/** The opening tag of the first element with this class, so attribute order never matters. */
function tagWithClass(body: string, cls: string): string {
  const tag = [...body.matchAll(/<(?:a|span)\b[^>]*>/g)].map((m) => m[0]).find((t) => t.includes(cls));
  expect(tag, `an element carrying ${cls}`).toBeDefined();
  return tag!;
}
const titleOf = (tag: string) => /\stitle="([^"]*)"/.exec(tag)?.[1];

describe('PartyLabel name title', () => {
  it('a person carries the full name as the clamped span title', () => {
    const body = html({ kind: 'USER', id: 'u1', name: long, urn: null });
    expect(titleOf(tagWithClass(body, 'line-clamp-1'))).toBe(long);
  });
  it('a blank person name falls back to the id', () => {
    expect(titleOf(tagWithClass(html({ kind: 'USER', id: 'u2', name: ' ', urn: null }), 'line-clamp-1'))).toBe('u2');
  });
  it('an absent person name falls back to the id', () => {
    expect(titleOf(tagWithClass(html({ kind: 'USER', id: 'u3', name: null, urn: null }), 'line-clamp-1'))).toBe('u3');
  });
  it('a name with quotes and an ampersand is escaped inside the attribute', () => {
    const body = html({ kind: 'USER', id: 'u4', name: 'Alex "The Hammer" & Co', urn: null });
    expect(titleOf(tagWithClass(body, 'line-clamp-1'))).toBe('Alex &quot;The Hammer&quot; &amp; Co');
  });
  it('a worker carries the title on its link, and its URN still renders', () => {
    const body = html({ kind: 'WORKER', id: 'w1', name: long, urn });
    expect(titleOf(tagWithClass(body, 'href="/app/workers/w1"'))).toBe(long);
    expect(body).toContain(urn);
  });
  it('a nameless worker falls back to the id on its link', () => {
    const body = html({ kind: 'WORKER', id: 'w2', name: null, urn: null });
    expect(titleOf(tagWithClass(body, 'href="/app/workers/w2"'))).toBe('w2');
  });
});
