/**
 * AssetTable — SSR smoke tests (this repo has no DOM test env for components;
 * see conventions:svelte-component-test-gap).
 *
 * Both URN columns now render through the shared <Urn> chip (maintainer's call),
 * which means the cell no longer navigates — that is deliberate, and asserted
 * below so nobody "restores" an anchor by accident.
 *
 * The load-bearing case is the LEGACY OWNERSHIP CHAIN: <Urn> normalises for
 * display via parseUrnV2(input.replaceAll('::', ':')), so handing it a chain would
 * render — and copy — a flat URN naming a DIFFERENT memory. That is the same
 * flattening codex flagged as P1 on #704, reappearing at the display layer, so a
 * chain is rendered as plain text instead.
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

  it('does NOT navigate — the chip is not an anchor, deliberately', () => {
    // Reaching the memory is now copy-URL rather than a click. Pinned so the
    // trade-off is a decision in the diff, not a surprise.
    expect(body([asset()])).not.toContain('/app/u/');
  });

  it('shows the memory URN, not a raw memory id', () => {
    const html = body([asset()]);
    expect(html).toContain('hrn:mem:hadronmemory.com:dev');
    expect(html).not.toContain('mem-1');
  });

  it('renders a legacy ownership chain as plain text, never through the chip', () => {
    // <Urn> would collapse `::` and show hrn:mem:acme:app:agent:system — a
    // different memory — and its copy button would hand that over. So the chain
    // stays plain text, unflattened.
    const html = body([asset({ urn: 'hrn:asset:acme:app:agent:system:assets:a1' })]);
    expect(html).toContain('hrn:memory:acme::app::agent::system');
    expect(html).not.toContain('hrn:mem:acme:app:agent:system');
  });

  it('falls back to plain text when the urn will not parse', () => {
    // A chip built from a guess could name someone else's memory.
    const html = body([asset({ urn: 'garbage', memoryId: 'mem-9' })]);
    expect(html).toContain('mem-9');
    expect(html).not.toContain('>mem:</span>');
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
