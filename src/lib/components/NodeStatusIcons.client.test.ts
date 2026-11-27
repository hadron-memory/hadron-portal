import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRawSnippet } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import NodeStatusIcons from './NodeStatusIcons.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { vi.useRealTimers(); while (mounted.length) mounted.pop()!.unmount(); });

const panel = (text: string) => createRawSnippet(() => ({ render: () => `<button type="button">${text}</button>` }));

const mountIcons = (over: Record<string, unknown> = {}) => {
  const m = mountComponent(NodeStatusIcons as never, {
    approval: { state: 'APPROVED', tone: 'approved', approval: null, canApprove: false },
    mint: { kind: 'unminted' },
    signatures: { kind: 'none' },
    signingOn: false,
    approvalPanel: panel('approve-panel'),
    mintPanel: panel('mint-panel'),
    signaturePanel: panel('sign-panel'),
    ...over,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
};
const icon = (t: HTMLElement, kind: string) => t.querySelector<HTMLButtonElement>(`[data-testid="status-icon-${kind}"]`);
const shown = (t: HTMLElement, kind: string) => !t.querySelector<HTMLElement>(`#node-status-${kind}`)!.hidden;

describe('NodeStatusIcons', () => {
  it('says each state in words, and marks it by look as well as colour', () => {
    const t = mountIcons({ mint: { kind: 'minted', status: { minted: true, revision: 2 }, minter: 'Ada', editedSince: true } });
    expect(icon(t, 'approval')!.getAttribute('aria-label')).toBe('Approval: Approved');
    expect(icon(t, 'approval')!.dataset.look).toBe('done');
    expect(icon(t, 'mint')!.getAttribute('aria-label')).toBe('Mint: Minted, edited since minting');
    expect(icon(t, 'mint')!.dataset.look).toBe('attention');
    // The attention dot is a second cue beside the amber.
    expect(icon(t, 'mint')!.querySelector('span[aria-hidden="true"]')).not.toBeNull();
  });

  it('gives approval, mint and signature three different glyphs and, when done, three different hues', () => {
    const t = mountIcons({
      mint: { kind: 'minted', status: { minted: true, revision: 2 }, minter: null, editedSince: false },
      signatures: { kind: 'shown', label: 'Signed', tone: 'signed', rows: [], integrityProblems: 0 },
    });
    const glyph = (k: string) => icon(t, k)!.querySelector('svg')!.getAttribute('class')!.split(' ').find((c) => c.startsWith('lucide-') && c !== 'lucide-icon');
    expect(new Set(['approval', 'mint', 'signature'].map(glyph)).size).toBe(3);
    expect(new Set(['approval', 'mint', 'signature'].map((k) => icon(t, k)!.className.match(/bg-(\w+)-100/)![1])).size).toBe(3);
  });

  it('draws no signature icon with signing off and nothing signed; with signing on it offers one', () => {
    expect(icon(mountIcons(), 'signature')).toBeNull();
    expect(icon(mountIcons({ signingOn: true }), 'signature')!.getAttribute('aria-label')).toBe('Signature: Not signed');
  });

  it('draws a signature icon for a signed node even with signing off', () => {
    const t = mountIcons({ signatures: { kind: 'shown', label: 'Signed', tone: 'signed', rows: [], integrityProblems: 0 } });
    expect(icon(t, 'signature')!.dataset.look).toBe('done');
  });

  it('opens one panel at a time, and Escape shuts it and returns focus to its icon', async () => {
    const t = mountIcons({ signingOn: true });
    icon(t, 'approval')!.click();
    await tick(2);
    expect([shown(t, 'approval'), shown(t, 'mint'), shown(t, 'signature')]).toEqual([true, false, false]);
    expect(icon(t, 'approval')!.getAttribute('aria-expanded')).toBe('true');
    icon(t, 'mint')!.click();
    await tick(2);
    expect([shown(t, 'approval'), shown(t, 'mint')]).toEqual([false, true]);
    icon(t, 'mint')!.focus();
    icon(t, 'mint')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await tick(2);
    expect(shown(t, 'mint')).toBe(false);
    expect(document.activeElement).toBe(icon(t, 'mint'));
  });

  it('a click outside shuts the open panel; a click inside it does not', async () => {
    const t = mountIcons();
    icon(t, 'approval')!.click();
    await tick(2);
    t.querySelector<HTMLElement>('#node-status-approval button')!.click();
    await tick(2);
    expect(shown(t, 'approval')).toBe(true);
    document.body.click();
    await tick(2);
    expect(shown(t, 'approval')).toBe(false);
  });

  it('keeps the panels mounted while shut, so the page’s forms are always its own', () => {
    const t = mountIcons();
    expect(t.querySelector('#node-status-approval button')!.textContent).toBe('approve-panel');
  });

  it('says it is loading while the approval read is on its way', () => {
    expect(icon(mountIcons({ approval: null }), 'approval')!.getAttribute('aria-label')).toBe('Approval: Loading approval status…');
  });

  const hover = (el: Element, type: 'mouseenter' | 'mouseleave') => el.dispatchEvent(new MouseEvent(type, { bubbles: false }));

  it('shows a panel while the pointer rests on its icon, and shuts it a moment after the pointer leaves', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = mountIcons();
    hover(icon(t, 'approval')!, 'mouseenter');
    await tick(2);
    expect(shown(t, 'approval')).toBe(true);
    hover(icon(t, 'approval')!, 'mouseleave');
    await tick(2);
    expect(shown(t, 'approval')).toBe(true); // the grace for crossing to the panel
    vi.advanceTimersByTime(250);
    await tick(2);
    expect(shown(t, 'approval')).toBe(false);
  });

  it('keeps a panel open while the pointer moves from its icon onto it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = mountIcons();
    hover(icon(t, 'approval')!, 'mouseenter');
    hover(icon(t, 'approval')!, 'mouseleave');
    hover(t.querySelector('#node-status-approval')!, 'mouseenter');
    vi.advanceTimersByTime(500);
    await tick(2);
    expect(shown(t, 'approval')).toBe(true);
  });

  it('a click pins the panel past the pointer leaving; a second click unpins it', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const t = mountIcons();
    hover(icon(t, 'approval')!, 'mouseenter');
    icon(t, 'approval')!.click();
    hover(icon(t, 'approval')!, 'mouseleave');
    vi.advanceTimersByTime(500);
    await tick(2);
    expect(shown(t, 'approval')).toBe(true);
    icon(t, 'approval')!.click();
    await tick(2);
    expect(shown(t, 'approval')).toBe(false);
  });

  it('a tap elsewhere ends a touch "hover", which no mouseleave will', async () => {
    const t = mountIcons();
    hover(icon(t, 'approval')!, 'mouseenter');
    await tick(2);
    expect(shown(t, 'approval')).toBe(true);
    document.body.click();
    await tick(2);
    expect(shown(t, 'approval')).toBe(false);
  });

  it('puts each panel straight after its own icon, so Tab goes from the icon into its panel', () => {
    const t = mountIcons({ mint: { kind: 'minted', status: { minted: true, revision: 2 }, minter: null, editedSince: false }, signingOn: true });
    for (const kind of ['approval', 'mint', 'signature']) {
      expect(icon(t, kind)!.nextElementSibling?.id).toBe(`node-status-${kind}`);
    }
  });

  it('shuts a pinned panel when keyboard focus moves out of the cluster; a click on plain text inside does not', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const t = mountIcons();
    icon(t, 'approval')!.click();
    await tick(2);
    // Focus leaves to nothing (a click on text in the panel): stays open.
    icon(t, 'approval')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    await tick(2);
    expect(shown(t, 'approval')).toBe(true);
    // Focus moves to another control inside the cluster: stays open.
    icon(t, 'approval')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: t.querySelector('#node-status-approval button') }));
    await tick(2);
    expect(shown(t, 'approval')).toBe(true);
    // Tab on to a control elsewhere: shut.
    t.querySelector('#node-status-approval button')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    await tick(2);
    expect(shown(t, 'approval')).toBe(false);
    outside.remove();
  });

  it('aria-expanded follows the pin, not the hover', async () => {
    const t = mountIcons();
    hover(icon(t, 'approval')!, 'mouseenter');
    await tick(2);
    expect(shown(t, 'approval')).toBe(true);
    expect(icon(t, 'approval')!.getAttribute('aria-expanded')).toBe('false');
    icon(t, 'approval')!.click();
    await tick(2);
    expect(icon(t, 'approval')!.getAttribute('aria-expanded')).toBe('true');
  });
});
