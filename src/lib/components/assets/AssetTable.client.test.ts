/**
 * #1020: the asset row's actions live in a ⋯ menu, so what each action says
 * and whether it is offered can only be checked with the menu OPEN — the
 * client lane. The two assertions moved here from AssetTable.test.ts (#707's
 * PENDING wording, the hotlink control) keep their original intent.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import type { AssetSummary } from '$lib/api/assetUpload';
import AssetTable from './AssetTable.svelte';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function asset(over: Partial<AssetSummary> = {}): AssetSummary {
  return {
    id: 'asset-1', memoryId: 'mem-1', urn: 'hrn:asset:hadronmemory.com:dev:assets:asset-1',
    filename: 'notes.md', mimeType: 'text/markdown', sizeBytes: 2048,
    uploadedAt: '2026-08-01T10:00:00.000Z', uploadedBy: 'user-1',
    scanStatus: 'CLEAN', scanSignature: null, description: null, publicUrl: null,
    publicLinkEnabled: false, canManagePublicLink: false, publicLinkAvailable: false,
    ...over,
  };
}

function openMenu(assets: AssetSummary[]) {
  const m = mountComponent(AssetTable as never, { assets, showMemory: true } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  m.target.querySelector<HTMLButtonElement>('button[aria-label="Actions for notes.md"]')!.click();
  flushSync();
  const items = [...m.target.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]')];
  return { target: m.target, items, item: (label: string) => items.find((i) => i.textContent?.trim() === label) };
}

describe('AssetTable row ⋯ menu (#1020)', () => {
  it('offers Download and Delete for a clean file, and no inline icon buttons', () => {
    const { target, items, item } = openMenu([asset()]);
    expect(items.map((i) => i.textContent?.trim())).toEqual(['Download', 'Delete']);
    expect(item('Download')!.getAttribute('aria-disabled')).toBeNull();
    // The old per-row icon buttons are gone; only the menu trigger remains.
    expect(target.querySelector('button[aria-label="Delete notes.md"]:not([role="menuitem"])')).toBeNull();
  });

  it('offers Copy public link only when the server minted a publicUrl', () => {
    expect(openMenu([asset({ publicUrl: 'https://x/assets/asset-1' })]).item('Copy public link')).toBeDefined();
  });

  it('shows Download disabled for a PENDING file, saying it is unsettled without promising it arrives', () => {
    // #707 (@codex P2): PENDING must stay distinguishable from BLOCKED, and must
    // not promise the file is coming — a pending scan can finish BLOCKED.
    const download = openMenu([asset({ scanStatus: 'PENDING' })]).item('Download')!;
    expect(download.getAttribute('aria-disabled')).toBe('true');
    const said = `${download.getAttribute('title')} ${download.getAttribute('aria-label')}`;
    expect(said).toMatch(/has not finished/i);
    expect(said).toMatch(/only if it passes/i);
    expect(said).not.toMatch(/once the malware scan/i);
  });

  it('picking Delete expands the inline confirm in place', () => {
    const { target, item } = openMenu([asset()]);
    item('Delete')!.click();
    flushSync();
    const confirm = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Delete' && !b.getAttribute('role'));
    expect(confirm).toBeDefined();
    expect([...target.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Cancel')).toBe(true);
  });
});
