/**
 * #707 — AssetChip scan state, SSR.
 *
 * Written for @codex's P2 on #814: the signature reached the DOM only as a
 * `title` on a NON-FOCUSABLE inner span, so keyboard and screen-reader users
 * got the bare word "Blocked" and touch users got nothing. Present in the
 * markup is not the same as available to the reader — the same distinction
 * that made the Scan column's truncated `Signature:…` a non-fix.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import AssetChip from './AssetChip.svelte';
import type { AssetSummary } from '$lib/api/assetUpload';

function asset(over: Partial<AssetSummary> = {}): AssetSummary {
  return {
    id: 'asset-1',
    memoryId: 'mem-1',
    urn: 'hrn:asset:hadronmemory.com:dev:assets:asset-1',
    filename: 'notes.md',
    mimeType: 'text/markdown',
    sizeBytes: 2048,
    uploadedAt: '2026-08-01T10:00:00.000Z',
    uploadedBy: 'user-1',
    scanStatus: 'CLEAN',
    scanSignature: null,
    description: null,
    publicUrl: null,
    ...over,
  };
}

const body = (over: Partial<AssetSummary>) => render(AssetChip, { props: { asset: asset(over) } }).body;

describe('AssetChip scan state (#707)', () => {
  it('puts the blocked reason and signature in text, not only a tooltip', () => {
    const html = body({ scanStatus: 'BLOCKED', scanSignature: 'Eicar-Test-Signature' });
    expect(html).toContain('Blocked');
    // sr-only, so it is announced rather than merely hoverable.
    expect(html).toMatch(/sr-only/);
    expect(html).toContain('Eicar-Test-Signature');
    expect(html).toMatch(/final/i);
  });

  it('carries the note on the button, not on an inner span', () => {
    // The defect precisely: a title on a non-focusable child is reachable by
    // neither keyboard nor touch. Assert the button element carries it.
    const html = body({ scanStatus: 'BLOCKED', scanSignature: 'Eicar-Test-Signature' });
    const buttonTag = html.slice(html.indexOf('<button'), html.indexOf('>', html.indexOf('<button')) + 1);
    expect(buttonTag).toContain('title=');
    expect(buttonTag).toMatch(/final/i);
  });

  it('explains a PENDING chip without promising the file arrives', () => {
    const html = body({ scanStatus: 'PENDING' });
    expect(html).toContain('Scanning');
    expect(html).toMatch(/only if it passes/i);
    expect(html).not.toMatch(/once the malware scan/i);
  });

  it('adds no scan note at all for a CLEAN asset', () => {
    // A CLEAN chip is not a download control on every surface it appears on, so
    // describing it as one would name the wrong action.
    const html = body({ scanStatus: 'CLEAN' });
    expect(html).not.toMatch(/sr-only/);
    expect(html).not.toMatch(/malware scan/i);
  });

  it('shows no signature for a blocked asset the scanner did not name', () => {
    const html = body({ scanStatus: 'BLOCKED', scanSignature: null });
    expect(html).toContain('Blocked');
    expect(html).not.toContain('Signature:');
  });
});
