/**
 * AssetTable — SSR smoke tests (this repo has no DOM test env for components;
 * see conventions:svelte-component-test-gap).
 *
 * Written because PR #704's review (codex P2) caught the Memory cell claiming to
 * link to the holding memory while rendering a <Urn> chip, which emits spans and
 * copy buttons and no anchor at all. The comment said "links"; the markup didn't.
 * An assertion on the actual emitted href is the only thing that keeps those two
 * honest, so that is what these do.
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
  it('renders a real anchor at the /app/u/<urn> resolver', () => {
    // The regression this file exists for: a <Urn> chip has no anchor, so the
    // cell was inert.
    expect(body([asset()])).toContain('href="/app/u/hrn:mem:hadronmemory.com:dev"');
  });

  it('shows the memory URN, not a raw memory id', () => {
    const html = body([asset()]);
    expect(html).toContain('hrn:mem:hadronmemory.com:dev');
    expect(html).not.toContain('mem-1');
  });

  it('PRESERVES a legacy ownership chain in the href', () => {
    // codex P1: a flattened chain silently addresses a different memory.
    const html = body([asset({ urn: 'hrn:asset:acme:app:agent:system:assets:a1' })]);
    expect(html).toContain('href="/app/u/hrn:memory:acme::app::agent::system"');
    expect(html).not.toContain('/app/u/hrn:mem:acme:app:agent:system');
  });

  it('falls back to plain text — no link — when the urn will not parse', () => {
    // A guessed link could point at someone else's memory.
    const html = body([asset({ urn: 'garbage', memoryId: 'mem-9' })]);
    expect(html).not.toContain('/app/u/');
    expect(html).toContain('mem-9');
  });

  it('shows the memory URN inside the resolver link, not a separate label', () => {
    // The cell text and the href now agree, so a reader can see where the link
    // goes without hovering.
    const html = body([asset()]);
    const cell = html.slice(html.indexOf('/app/u/hrn:mem:hadronmemory.com:dev'));
    expect(cell).toContain('hrn:mem:hadronmemory.com:dev');
  });

  it('omits the memory column entirely when showMemory is false', () => {
    const html = render(AssetTable, { props: { assets: [asset()], showMemory: false } }).body;
    expect(html).not.toContain('/app/u/');
  });
});

describe('AssetTable file column', () => {
  it('shows the asset URN rather than the filename', () => {
    const html = body([asset()]);
    expect(html).toContain('hrn:asset:hadronmemory.com:dev:assets:asset-1');
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
