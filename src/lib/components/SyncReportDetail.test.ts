import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import SyncReportDetail from './SyncReportDetail.svelte';
const at = '2026-10-26T01:02:03.000Z';
const raw = (outcome: string, entries: unknown[] = []) => JSON.stringify({ version: 1, outcome, recordedAt: at, entries, ...(outcome === 'failed' ? { code: 'SYNC_FAILED' } : {}) });
const rawV2 = (entries: unknown[]) => JSON.stringify({ version: 2, outcome: 'partial', recordedAt: at, entries });
const attestationCodes = ['AUTHORING_ATTESTATION_MISSING', 'AUTHORING_ATTESTATION_WRONG_TASK', 'AUTHORING_ATTESTATION_STALE', 'AUTHOR_TASK_BROKEN'] as const;
describe('SyncReportDetail', () => {
  it.each([['partial', 'succeeded'], ['unknown', 'can’t confirm'], ['failed', 'failed']])('renders %s', (outcome, copy) => {
    const body = render(SyncReportDetail, { props: { lastSyncReport: raw(outcome), syncStatus: 'OK', lastSyncedAt: at } }).body;
    expect(body).toContain('Last recorded outcome'); expect(body).toContain(copy);
    expect(body).toContain(at); expect(body).not.toContain('Memory synced.');
  });
  it.each(attestationCodes)('renders v2 attestation and v1 entries with labels and the fixed code %s', (code) => {
    const entries = [
      { kind: 'attestation_refused', loc: 'a', code },
      { kind: 'protected', loc: 'z', code: 'PROTECTED_LOC' },
    ];
    const body = render(SyncReportDetail, { props: { lastSyncReport: rawV2(entries), syncStatus: 'OK', lastSyncedAt: at } }).body;
    expect(body).toContain('Attestation refused');
    expect(body).toContain('Protected');
    expect(body).toContain(code);
    expect(body).toContain('PROTECTED_LOC');
    expect(body).not.toContain('Report unavailable');
  });

  it('labels all six v1 kinds instead of leaving raw snake_case in the Kind column', () => {
    const entries = [
      { kind: 'protected', loc: 'p', code: 'PROTECTED_LOC' },
      { kind: 'object_type_rejected', loc: 'o', code: 'OBJECT_TYPE_REJECTED' },
      { kind: 'undeclared_role', loc: 'u', code: 'ROLE_NOT_DECLARED' },
      { kind: 'invalid_include', loc: 'i', code: 'INVALID_INCLUDE' },
      { kind: 'deferred', loc: 'd', code: 'ROW_CHANGED' },
      { kind: 'held_move', loc: 'h', fromLoc: 'old', code: 'MOVE_HELD' },
    ];
    const body = render(SyncReportDetail, { props: { lastSyncReport: raw('partial', entries), syncStatus: 'OK', lastSyncedAt: at } }).body;
    for (const label of ['Protected', 'Object type rejected', 'Undeclared role', 'Invalid include', 'Deferred', 'Move held']) expect(body).toContain(label);
    for (const fixed of ['PROTECTED_LOC', 'OBJECT_TYPE_REJECTED', 'ROLE_NOT_DECLARED', 'INVALID_INCLUDE', 'ROW_CHANGED', 'MOVE_HELD']) expect(body).toContain(fixed);
  });

  it('escapes source text and rejects unknown secret-bearing codes', () => {
    const entry = { kind: 'held_move', loc: '<script>alert(1)</script>', fromLoc: 'old', code: 'MOVE_HELD' };
    const body = render(SyncReportDetail, { props: { lastSyncReport: raw('partial', [entry]) } }).body;
    expect(body).not.toContain('<script>'); expect(body).toContain('&lt;script>');
    const bad = render(SyncReportDetail, { props: { lastSyncReport: raw('partial', [{ ...entry, code: 'ghs_SECRET' }]) } }).body;
    expect(bad).toContain('Report unavailable'); expect(bad).not.toContain('ghs_SECRET');
  });
});

it('distinguishes null, omitted, malformed completion and a never-run memory', () => {
  const body = (lastSyncReport: string | null | undefined, lastSyncedAt: string | null) => render(SyncReportDetail, { props: { lastSyncReport, lastSyncedAt, syncStatus: 'OK' } }).body;
  expect(body(null, at)).toContain('applied everything');
  expect(body(null, null)).toContain('No clean completed sync is confirmed');
  expect(body(undefined, at)).toContain('Report unavailable');
  expect(body(null, 'bad')).toContain('Report unavailable');
});
