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
    publicLinkEnabled: false,
    canManagePublicLink: false,
    publicLinkAvailable: false,
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

  it('renders the signature VISIBLY, not only in a tooltip or sr-only text', () => {
    // @codex round 3: a sighted touch user can neither hover a title nor hear
    // an sr-only span, and in AgentAssetsList tapping the chip runs download —
    // so no gesture revealed it. Strip the sr-only span and the title, and the
    // signature must STILL be in the visible markup.
    const html = body({ scanStatus: 'BLOCKED', scanSignature: 'Eicar-Test-Signature' });
    const withoutSrOnly = html.replace(/<span class="sr-only">[\s\S]*?<\/span>/g, '');
    const visible = withoutSrOnly.replace(/title="[^"]*"/g, '');
    expect(visible).toContain('Eicar-Test-Signature');
  });

  it('announces the signature once, not twice', () => {
    // @codex round 4: the sr-only note and the visible span are both
    // descendants of the button, so both join its accessible name. Keeping the
    // signature in the note made a screen reader read it twice — the note now
    // carries only the verdict, which the visible text cannot say.
    const html = body({ scanStatus: 'BLOCKED', scanSignature: 'Eicar-Test-Signature' });
    const srOnly = html.match(/<span class="sr-only">([\s\S]*?)<\/span>/)?.[1] ?? '';
    expect(srOnly).toMatch(/final/i);
    expect(srOnly).not.toContain('Eicar-Test-Signature');
    // Exactly one copy in the rendered content.
    expect(html.split('Eicar-Test-Signature').length - 1).toBe(2); // visible span + title
  });

  it('does not clip the signature', () => {
    // Truncating puts a touch user back where they started: the only full copy
    // would be a title they cannot open. Same mistake as the Scan column at 100px.
    const html = body({ scanStatus: 'BLOCKED', scanSignature: 'Eicar-Test-Signature' });
    expect(html).not.toMatch(/truncate[^"]*"[^>]*>\s*Signature:/);
    const sigSpan = html.match(/<span class="([^"]*)"[^>]*>Signature: Eicar-Test-Signature<\/span>/)?.[1] ?? '';
    expect(sigSpan).not.toContain('truncate');
    expect(sigSpan).not.toMatch(/max-w-/);
  });

  it('shows no signature for a blocked asset the scanner did not name', () => {
    const html = body({ scanStatus: 'BLOCKED', scanSignature: null });
    expect(html).toContain('Blocked');
    expect(html).not.toContain('Signature:');
  });
});
