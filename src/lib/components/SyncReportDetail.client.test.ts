import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import SyncReportDetail from './SyncReportDetail.svelte';

const at = '2026-10-26T01:02:03.000Z';
const lastSyncReport = JSON.stringify({
  version: 2,
  outcome: 'partial',
  recordedAt: at,
  entries: [
    { kind: 'attestation_refused', loc: 'a', code: 'AUTHORING_ATTESTATION_MISSING' },
    { kind: 'held_move', loc: 'h', fromLoc: 'old', code: 'MOVE_HELD' },
  ],
});

let mounted: Mounted<Record<string, unknown>> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });

describe('#1783 sync report search sees the rendered labels', () => {
  it.each(['Attestation refused', 'attestation_refused'])('finds the attestation row by %s and not an unrendered label', (query) => {
    mounted = mountComponent(SyncReportDetail as never, { lastSyncReport, syncStatus: 'OK', lastSyncedAt: at } as never) as Mounted<Record<string, unknown>>;
    const { target } = mounted;
    const input = target.querySelector<HTMLInputElement>('input[placeholder*="Search recorded outcomes"]')!;
    const rows = () => [...target.querySelectorAll('tbody tr')].map(row => row.textContent ?? '');
    const search = (value: string) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); };

    expect(rows()).toHaveLength(2);
    search(query);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('Attestation refused');
    expect(rows()[0]).toContain('AUTHORING_ATTESTATION_MISSING');
    expect(rows()[0]).not.toContain('MOVE_HELD');

    search('Object type rejected');
    expect(rows()).toHaveLength(0);
    search('Move held');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('MOVE_HELD');
  });
});
