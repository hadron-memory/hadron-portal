import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SyncReportDetail from './SyncReportDetail.svelte';
const at = '2026-10-26T01:02:03.000Z';
const raw = (outcome: string, entries: unknown[] = []) => JSON.stringify({ version: 1, outcome, recordedAt: at, entries, ...(outcome === 'failed' ? { code: 'SYNC_FAILED' } : {}) });
describe('SyncReportDetail', () => {
  it.each([['partial', 'succeeded'], ['unknown', 'can’t confirm'], ['failed', 'failed']])('renders %s', (outcome, copy) => {
    const body = render(SyncReportDetail, { props: { lastSyncReport: raw(outcome), syncStatus: 'OK', lastSyncedAt: at } }).body;
    expect(body).toContain('Last recorded outcome'); expect(body).toContain(copy);
    expect(body).toContain(at); expect(body).not.toContain('Memory synced.');
  });
  it('escapes source text and rejects unknown secret-bearing codes', () => {
    const entry = { kind: 'held_move', loc: '<script>alert(1)</script>', fromLoc: 'old', code: 'MOVE_HELD' };
    const body = render(SyncReportDetail, { props: { lastSyncReport: raw('partial', [entry]) } }).body;
    expect(body).not.toContain('<script>'); expect(body).toContain('&lt;script&gt;');
    const bad = render(SyncReportDetail, { props: { lastSyncReport: raw('partial', [{ ...entry, code: 'ghs_SECRET' }]) } }).body;
    expect(bad).toContain('Report unavailable'); expect(bad).not.toContain('ghs_SECRET');
  });
});
