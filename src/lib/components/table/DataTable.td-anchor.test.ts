/**
 * portal#2548 — DataTable's td is `relative` so an sr-only label is anchored by its own cell. That must not clip the one menu
 * that lives in a cell: NodeActionsMenu is its own `relative` root, so its `absolute` dropdown already had a containing block
 * inside the cell (a td clips only what its own box contains), and its `fixed` variant is outside any clip. These pins keep both
 * halves of that argument true; the browser leg for the labels is scripts/test-table-cell-overflow-layout.mjs (orgs-sessions).
 */
import { describe, expect, it } from 'vitest';
import dataTable from './DataTable.svelte?raw';
import nodeActionsMenu from '../NodeActionsMenu.svelte?raw';

describe('DataTable td anchoring (portal#2548)', () => {
  it('the body td is position:relative', () => {
    const td = /<td data-cell-contained[^>]*class="([^"]*)"/.exec(dataTable)?.[1] ?? '';
    expect(td.split(/\s+/)).toContain('relative');
  });

  it('NodeActionsMenu is its own relative root, and its inline dropdown is absolute inside it', () => {
    expect(nodeActionsMenu).toMatch(/<div bind:this=\{rootEl\} class="relative" data-node-actions/);
    expect(nodeActionsMenu).toContain("{fixed ? 'fixed' : 'absolute right-0 mt-2'}");
  });
});
