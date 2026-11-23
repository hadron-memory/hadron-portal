// hadron-portal#2134 — what the person sees (SSR markup).
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, appId: 'app-' + id, action: 'node.read', holderKind: 'USER', holderId: 'u1', values: null, reason: 'because',
  startsAt: null, expiresAt: null, maxUses: null, useCount: 0, createdAt: '2026-01-01T00:00:00Z',
  activatedAt: null, revokedAt: null, allows: false, app: null, appStatus: 'unopenable', ...over,
});
const html = (data: unknown) => render(Page as never, { props: { data } as never }).body;

describe('my grants page', () => {
  it('impersonation: says unavailable and never "no grants"', () => {
    const h = html({ unavailable: true, grants: [] });
    expect(h).toContain('my-grants-unavailable');
    expect(h).not.toContain('You have no grants');
  });
  it('a person signed in as themselves with none reads "no grants"', () => {
    const h = html({ unavailable: false, grants: [] });
    expect(h).toContain('You have no grants');
    expect(h).not.toContain('my-grants-unavailable');
  });
  it('puts "Allows now" before the wide App column so a 390px scroller shows it', () => {
    const h = html({ unavailable: false, grants: [row('g1')] });
    const allows = h.indexOf('Allows now');
    expect(allows).toBeGreaterThan(-1);
    expect(allows).toBeLessThan(h.search(/>\s*App\s*</));
  });
  it('keeps a row for an App the person cannot open, naming its id', () => {
    const h = html({ unavailable: false, grants: [row('g1')] });
    expect(h).toContain('my-grant-row');
    expect(h).toContain("can't open");
    expect(h).toContain('app-g1');
  });
  it('a lookup that failed is not called an access refusal', () => {
    const h = html({ unavailable: false, grants: [row('g3', { appStatus: 'unavailable' })] });
    expect(h).toContain('could not be loaded');
    expect(h).not.toContain("can't open");
  });
  it('shows the intro and key: value text, not raw JSON', () => {
    const h = html({ unavailable: false, grants: [row('g4', { values: { loc: 'findings:*' } })] });
    expect(h).toContain('in effect now');
    expect(h).toContain('loc: findings:*');
    expect(h).not.toContain('{&quot;loc');
  });
  // portal#2516: a dotted action id breaks at its dots, not inside a word; the text a reader copies is unchanged.
  it('offers a break after each dot of the Action id and keeps the id text whole', () => {
    const h = html({ unavailable: false, grants: [row('g5', { action: 'node.admin.read' })] });
    // The SSR output carries hydration comments between the parts and writes the void element as <wbr/>.
    const flat = h.replace(/<!--.*?-->/g, '').replace(/<wbr\s*\/?>/g, '‹wbr›');
    expect(flat).toContain('node.‹wbr›admin.‹wbr›read');
    expect(flat.replaceAll('‹wbr›', '')).toContain('node.admin.read');
  });
  it('adds no break to a Reason or Values cell, whose text is free prose', () => {
    const h = html({ unavailable: false, grants: [row('g6', { reason: 'see.the.docs', values: { loc: 'a.b' } })] });
    expect(h).toContain('see.the.docs');
    expect(h).toContain('loc: a.b');
  });
  it('shows an openable App by name with its URN, and no derived state or signature wording', () => {
    const h = html({ unavailable: false, grants: [row('g2', { app: { id: 'a', name: 'Alpha', urn: 'hrn:app:hadronmemory.com:alpha' }, allows: true })] });
    expect(h).toContain('Alpha');
    expect(h).toContain('hrn:app:hadronmemory.com:alpha');
    for (const w of ['Pending', 'Active', 'Withdrawn', 'Departed', 'Signature', 'CURRENT']) expect(h).not.toContain(w);
  });
});
