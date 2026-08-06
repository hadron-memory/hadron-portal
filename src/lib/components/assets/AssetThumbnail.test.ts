import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';

import AssetThumbnail from './AssetThumbnail.svelte';

// SSR renders the component's static branches ($effect never runs server-side,
// so the presigned mint is out of scope here — what these tests pin down is
// which SLOT each asset kind gets, and that a hotlinked CLEAN image renders a
// real <img> once hydrated state applies. The slot must exist in every branch
// so rows never mis-align.

interface ThumbAsset {
  id: string;
  mimeType: string;
  scanStatus: 'PENDING' | 'CLEAN' | 'BLOCKED';
  publicUrl: string | null;
}

function thumb(overrides: Partial<ThumbAsset> = {}) {
  const asset: ThumbAsset = {
    id: 'a1',
    mimeType: 'image/jpeg',
    scanStatus: 'CLEAN',
    publicUrl: null,
    ...overrides,
  };
  return render(AssetThumbnail, { props: { asset } }).body;
}

describe('AssetThumbnail.svelte', () => {
  it('holds a placeholder slot for a CLEAN image while no src is resolved yet', () => {
    const body = thumb();
    expect(body).toContain('animate-pulse');
    expect(body).not.toContain('<img');
  });

  it('renders the mime icon, not an <img>, for a non-image', () => {
    const body = thumb({ mimeType: 'application/pdf' });
    expect(body).not.toContain('<img');
    expect(body).not.toContain('animate-pulse');
    // The fallback slot is aria-hidden decoration; the filename lives next to it.
    expect(body).toContain('aria-hidden');
  });

  it('renders the icon fallback for an image that is not CLEAN', () => {
    for (const scanStatus of ['PENDING', 'BLOCKED'] as const) {
      const body = thumb({ scanStatus });
      expect(body).not.toContain('<img');
      expect(body).not.toContain('animate-pulse');
      expect(body).toContain('aria-hidden');
    }
  });

  it('applies the caller-chosen slot size in every branch', () => {
    const icon = render(AssetThumbnail, {
      props: {
        asset: { id: 'a1', mimeType: 'text/plain', scanStatus: 'CLEAN' as const, publicUrl: null },
        sizeClass: 'size-12',
      },
    }).body;
    expect(icon).toContain('size-12');
    expect(thumb()).toContain('size-8'); // default
  });
});
