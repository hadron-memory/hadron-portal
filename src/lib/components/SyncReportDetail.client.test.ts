import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent } from '$lib/test/mountComponent';
import SyncReportDetail from './SyncReportDetail.svelte';

const at = '2026-10-26T01:02:03.000Z';
const lastSyncReport = JSON.stringify({
  version: 2,
  outcome: 'partial',
  recordedAt: at,
  entries: [
    { kind: 'attestation_refused', loc: 'attestation:source', code: 'AUTHORING_ATTESTATION_MISSING' },
    { kind: 'held_move', loc: 'held:source', fromLoc: 'held:old', code: 'MOVE_HELD' },
    { kind: 'invalid_include', loc: 'invalid:source', code: 'INVALID_INCLUDE' },
  ],
});

let unmount: (() => void) | undefined;
afterEach(() => { unmount?.(); unmount = undefined; });

describe('#1783 sync report search sees the rendered labels', () => {
  it.each(['Attestation refused', 'attestation refused', 'attestation_refused'])('finds the attestation row by %s without rendering the raw kind', (query) => {
    const mounted = mountComponent(SyncReportDetail, { lastSyncReport, syncStatus: 'OK', lastSyncedAt: at });
    unmount = mounted.unmount;
    const { target } = mounted;
    const input = target.querySelector<HTMLInputElement>('input[placeholder*="Search recorded outcomes"]')!;
    const rows = () => [...target.querySelectorAll('tbody tr')].map(row => row.textContent ?? '');
    const kindCells = () => [...target.querySelectorAll('tbody tr td:first-child')].map(cell => cell.textContent?.trim());
    const search = (value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); };

    expect(rows()).toHaveLength(3);
    search(query);
    expect(rows()).toHaveLength(1);
    expect(kindCells()).toEqual(['Attestation refused']);
    expect(rows()[0]).toContain('AUTHORING_ATTESTATION_MISSING');
    expect(rows()[0]).not.toContain('MOVE_HELD');

    search('MOVE_HELD');
    expect(rows()).toHaveLength(1);
    expect(kindCells()).toEqual(['Move held']);
    search('held:source');
    expect(rows()).toHaveLength(1);
    expect(kindCells()).toEqual(['Move held']);
    search('no-such-outcome');
    expect(rows()).toHaveLength(0);
  });

  it('sorts the Kind column by the rendered labels', () => {
    const mounted = mountComponent(SyncReportDetail, { lastSyncReport, syncStatus: 'OK', lastSyncedAt: at });
    unmount = mounted.unmount;
    const { target } = mounted;
    const kindCells = () => [...target.querySelectorAll('tbody tr td:first-child')].map(cell => cell.textContent?.trim());
    const kindSort = [...target.querySelectorAll<HTMLElement>('thead th')].find(header => header.textContent?.includes('Kind'))!;

    kindSort.click();
    flushSync();
    expect(kindCells()).toEqual(['Attestation refused', 'Invalid include', 'Move held']);
    kindSort.click();
    flushSync();
    expect(kindCells()).toEqual(['Move held', 'Invalid include', 'Attestation refused']);
  });
});
