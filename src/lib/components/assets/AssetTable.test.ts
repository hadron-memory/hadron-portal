/**
 * AssetTable — SSR smoke tests (this repo has no DOM test env for components;
 * see conventions:svelte-component-test-gap).
 *
 * Both URN columns render through the shared <Urn> chip. Only the MEMORY one is
 * `linked`: resolveUrn handles mem/node/org/agent/app/user, so an asset URN would
 * be a link that resolves to nothing. Both halves are asserted, because "which
 * chips are clickable" is the kind of thing that drifts silently.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

// SvelteKit virtuals, absent without the SvelteKit plugin
// (conventions:vitest-mocks-sveltekit-virtuals).
vi.mock('$app/stores', () => ({ page: { subscribe: (fn: (v: unknown) => void) => (fn({ url: new URL('http://x/'), data: {} }), () => {}) } }));
vi.mock('$app/navigation', () => ({ goto: () => {}, invalidate: () => {} }));

import AssetTable from './AssetTable.svelte';
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
    description: null,
    publicUrl: null,
    ...over,
  };
}

function body(assets: AssetSummary[], props: Record<string, unknown> = {}) {
  return render(AssetTable, { props: { assets, showMemory: true, ...props } }).body;
}

describe('AssetTable memory column', () => {
  it('renders the memory through the <Urn> chip', () => {
    const html = body([asset()]);
    // The chip splits the URN across spans but carries it whole in `title`.
    expect(html).toContain('title="hrn:mem:hadronmemory.com:dev"');
    // Its type badge, i.e. the chip really rendered rather than plain text.
    expect(html).toContain('>mem:</span>');
  });

  it('links the memory chip to the /app/u/<urn> resolver', () => {
    expect(body([asset()])).toContain('href="/app/u/hrn:mem:hadronmemory.com:dev"');
  });

  it('keeps the copy buttons OUTSIDE the anchor', () => {
    // A <button> inside an <a> is invalid and the anchor swallows its clicks, so
    // the link wraps only the chip. Two copy buttons survive per chip.
    const html = body([asset()]);
    expect(html).toContain('aria-label="Copy URN"');
    expect(html).toContain('aria-label="Copy URL"');
    // No button may appear between the opening <a> and its </a>.
    const a = html.slice(html.indexOf('<a href="/app/u/'));
    expect(a.slice(0, a.indexOf('</a>'))).not.toContain('<button');
  });

  it('shows the memory URN, not a raw memory id', () => {
    const html = body([asset()]);
    expect(html).toContain('hrn:mem:hadronmemory.com:dev');
    expect(html).not.toContain('mem-1');
  });

  it('renders no memory chip for a urn that is not root + slug', () => {
    // The derivation declines rather than guess, so there is nothing to link and
    // certainly no invented flat spelling.
    const html = body([asset({ urn: 'hrn:asset:acme:app:agent:system:assets:a1' })]);
    expect(html).not.toContain('hrn:mem:acme:app:agent:system');
    expect(html).not.toContain('href="/app/u/hrn:mem:acme');
  });

  it('falls back to plain text — and no link — when the urn will not parse', () => {
    // A chip built from a guess could name someone else's memory, and it would be
    // clickable.
    const html = body([asset({ urn: 'garbage', memoryId: 'mem-9' })]);
    expect(html).toContain('mem-9');
    expect(html).not.toContain('>mem:</span>');
    expect(html).not.toContain('/app/u/');
  });

  it('shows the memory URN rather than a short slug label', () => {
    const html = body([asset()]);
    expect(html).toContain('hadronmemory.com:dev');
  });

  it('omits the memory column entirely when showMemory is false', () => {
    const html = render(AssetTable, { props: { assets: [asset()], showMemory: false } }).body;
    expect(html).not.toContain('title="hrn:mem:hadronmemory.com:dev"');
    // The asset chip is still there — only the memory column drops out.
    expect(html).toContain('hrn:asset:hadronmemory.com:dev:assets:asset-1');
  });
});

describe('AssetTable file column', () => {
  it('shows the asset URN rather than the filename', () => {
    const html = body([asset()]);
    expect(html).toContain('hrn:asset:hadronmemory.com:dev:assets:asset-1');
  });

  it('does NOT link the asset chip — resolveUrn has no asset kind', () => {
    // It handles mem/node/org/agent/app/user; an asset link would 404.
    const html = body([asset()]);
    expect(html).not.toContain('href="/app/u/hrn:asset:');
  });

  it('keeps the filename SEARCHABLE even though it is no longer shown', () => {
    // The accessor feeds the global filter, so dropping the filename from it
    // would silently stop answering "find the row for notes.md".
    expect(body([asset()])).toContain('notes.md');
  });

  it('still shows the description under the URN', () => {
    expect(body([asset({ description: 'Q3 planning notes' })])).toContain('Q3 planning notes');
  });
});

describe('AssetTable row rendering', () => {
  it('labels a NULL uploader as the platform, not an em dash', () => {
    expect(body([asset({ uploadedBy: null })])).toContain('Hadron (agent run)');
  });

  it('labels the current user’s own upload as "You"', () => {
    expect(body([asset()], { currentUserId: 'user-1' })).toContain('You');
  });

  it('falls back to the uploader id when the handle could not be resolved', () => {
    // `user(ref:)` returns null for a user the caller may not see.
    expect(body([asset()])).toContain('user-1');
  });

  it('uses a resolved uploader handle when there is one', () => {
    expect(body([asset()], { uploaderNames: { 'user-1': '@ada' } })).toContain('@ada');
  });

  it('renders the size in human units, not raw bytes', () => {
    const html = body([asset({ sizeBytes: 2048 })]);
    expect(html).toContain('2.0 KB');
  });

  it('omits the hotlink control when the server minted no publicUrl', () => {
    // Absent, not disabled — a disabled control reads as "you lack permission".
    expect(body([asset({ publicUrl: null })])).not.toContain('Copy public link');
  });

  it('renders the hotlink control when there is a publicUrl', () => {
    expect(body([asset({ publicUrl: 'https://x/assets/asset-1' })])).toContain('Copy public link');
  });
});
