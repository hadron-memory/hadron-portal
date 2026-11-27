import { describe, expect, it } from 'vitest';
import { parseSyncReport, syncOutcomeMessage } from './sync-report';
const at = '2026-10-26T01:02:03.000Z';
const entry = { kind: 'held_move', loc: 'docs:new', fromLoc: 'docs:old', code: 'MOVE_HELD' };
const report = (over: Record<string, unknown> = {}) => JSON.stringify({ version: 1, outcome: 'partial', recordedAt: at, entries: [entry], ...over });
const attestationCodes = ['AUTHORING_ATTESTATION_MISSING', 'AUTHORING_ATTESTATION_WRONG_TASK', 'AUTHORING_ATTESTATION_STALE', 'AUTHOR_TASK_BROKEN'] as const;
describe('stored sync report', () => {
  it.each(['partial', 'unknown', 'failed'])('accepts %s without guessing clean', (outcome) => {
    const raw = report({ outcome, ...(outcome === 'failed' ? { entries: [], code: 'SYNC_FAILED' } : {}) });
    expect(parseSyncReport(raw, 'OK', at).state).toBe(outcome);
    expect(syncOutcomeMessage({ lastSyncReport: raw, syncStatus: 'OK', lastSyncedAt: at }).text).not.toBe('Memory synced.');
  });

  describe('#1783 reviewed report versions', () => {
    it.each(attestationCodes)('accepts v2 with %s beside a v1 entry, using the server fixture shape', (code) => {
      const entries = [
        { kind: 'attestation_refused', loc: 'a', code },
        { kind: 'protected', loc: 'z', code: 'PROTECTED_LOC' },
      ];
      expect(parseSyncReport(report({ version: 2, entries }), 'OK', at)).toEqual({ state: 'partial', recordedAt: at, entries });
    });

    it.each(attestationCodes)('keeps v1 closed against attestation_refused with %s', (code) => {
      const raw = report({ entries: [{ kind: 'attestation_refused', loc: 'a', code }] });
      expect(parseSyncReport(raw, 'OK', at).state).toBe('unavailable');
    });

    it.each([
      ['an unknown kind', { kind: 'future_kind', loc: 'a', code: 'AUTHORING_ATTESTATION_MISSING' }],
      ['an unknown code', { kind: 'attestation_refused', loc: 'a', code: 'OTHER' }],
      ['a code from another kind', { kind: 'attestation_refused', loc: 'a', code: 'MOVE_HELD' }],
      ['an attestation code on a v1 kind', { kind: 'protected', loc: 'a', code: 'AUTHORING_ATTESTATION_MISSING' }],
    ])('rejects v2 with %s', (_name, bad) => {
      expect(parseSyncReport(report({ version: 2, entries: [entry, bad] }), 'OK', at).state).toBe('unavailable');
    });
  });

  it('only explicit null plus completed metadata is clean', () => {
    expect(parseSyncReport(null, 'OK', at).state).toBe('clean');
    expect(parseSyncReport(null, 'PENDING', null).state).toBe('not_synced');
    expect(parseSyncReport(undefined, 'OK', at).state).toBe('unavailable');
    expect(parseSyncReport(null, 'OK', 'bad').state).toBe('unavailable');
    expect(parseSyncReport(null, 'OK', '2026-02-30T01:02:03.000Z').state).toBe('unavailable');
    expect(parseSyncReport(null, 'SYNCING', at).state).not.toBe('clean');
  });
  it.each([
    '{', 'null', '[]', report({ version: 3 }), report({ outcome: 'new' }), report({ outcome: ['partial'] }), report({ recordedAt: 'bad' }),
    report({ recordedAt: '2026-02-30T01:02:03.000Z' }), report({ entries: {} }),
    report({ entries: [entry, { ...entry, kind: 'new' }] }), report({ entries: [{ ...entry, code: 'ghs_SECRET' }] }),
    report({ entries: [{ ...entry, loc: 1 }] }), report({ entries: [{ ...entry, loc: 'https://x-access-token:ghs_SECRET@github.com/repo' }] }), report({ entries: [{ ...entry, fromLoc: null }] }),
    report({ outcome: 'failed', code: 'OTHER', entries: [] }), report({ outcome: 'failed', code: 'SYNC_FAILED' }),
  ])('rejects whole malformed/unknown report %s', raw => expect(parseSyncReport(raw, 'OK', at).state).toBe('unavailable'));
  it('projects only approved bounded fields', () => {
    const view = parseSyncReport(report({ secret: 'ghs_SECRET', entries: [{ ...entry, extra: 'ghs_SECRET', loc: 'x'.repeat(2000) }] }), 'OK', at);
    expect(JSON.stringify(view)).not.toContain('ghs_SECRET');
    expect(JSON.stringify(view).length).toBeLessThan(1000);
  });
  it('does not claim a clean sync on ERROR or draft/unfinished status', () => {
    expect(syncOutcomeMessage({ syncStatus: 'ERROR', lastSyncReport: null, lastSyncedAt: at }).type).toBe('error');
    expect(syncOutcomeMessage({ syncStatus: 'SYNCING', lastSyncReport: null, lastSyncedAt: at }).text).not.toBe('Memory synced.');
  });

});


describe('#1308 defensive source and feedback pins', () => {
  it.each(['https://user:secret@example.test/path', 'ghs_SYNTHETIC', 'github_pat_SYNTHETIC', 'hdr_app_SYNTHETIC', 'Bearer SYNTHETIC'])(
    'rejects the entire report when fromLoc contains %s', fromLoc => {
      expect(parseSyncReport(report({ entries: [{ ...entry, fromLoc }] }), 'OK', at)).toEqual({ state: 'unavailable', entries: [] });
      expect(parseSyncReport(report({ entries: [{ ...entry, fromLoc: 'docs:previous' }] }), 'OK', at).state).toBe('partial');
    },
  );
  it('uses only closed status copy, never a raw status value', () => {
    const text = syncOutcomeMessage({ syncStatus: 'ghs_SYNTHETIC <script>', lastSyncReport: null }).text;
    expect(text).toContain('status: —');
    expect(text).not.toContain('SYNTHETIC');
    expect(text).not.toContain('<script>');
    expect(syncOutcomeMessage({ syncStatus: 'SYNCING', lastSyncReport: null }).text).toContain('status: SYNCING');
  });
  it('does not call an OK status unfinished when completion is unconfirmed', () => {
    const text = syncOutcomeMessage({ syncStatus: 'OK', lastSyncReport: null, lastSyncedAt: null }).text;
    expect(text).toBe('No clean completed sync is confirmed. Check the sync status and last-synced time.');
    expect(text).not.toContain('didn’t finish');
  });
  it.each(['loc', 'fromLoc'] as const)('truncates %s by code points without cutting an astral character', field => {
    const source = 'x'.repeat(238) + '😀' + 'y'.repeat(10);
    const view = parseSyncReport(report({ entries: [{ ...entry, [field]: source }] }), 'OK', at);
    expect(view.entries[0][field]).toBe('x'.repeat(238) + '😀…');
    expect(Array.from(view.entries[0][field]!).length).toBe(240);
    const exact = '😀'.repeat(240);
    expect(parseSyncReport(report({ entries: [{ ...entry, [field]: exact }] }), 'OK', at).entries[0][field]).toBe(exact);
  });
});

describe("a sync refused for the owner's limit (#2569, door 20, C3-R7 a)", () => {
  const stored = report({ outcome: 'failed', code: 'OWNER_LIMIT_REACHED', entries: [] });
  it('parses the stored marker as a failed attempt carrying the code (on main: unavailable)', () => {
    expect(parseSyncReport(stored, 'ERROR', null)).toMatchObject({ state: 'failed', code: 'OWNER_LIMIT_REACHED' });
  });
  it('says the owner has reached a limit, in fixed copy, never the stored text', () => {
    const text = syncOutcomeMessage({ lastSyncReport: stored, syncStatus: 'ERROR', syncError: 'ghp_secrettoken leaked here' });
    expect(text).toEqual({ type: 'error', text: 'The sync was refused: the owner of this memory has reached a limit of their account.' });
  });
  it('still rejects an unknown failed code, and a limit code with entries', () => {
    expect(parseSyncReport(report({ outcome: 'failed', code: 'OTHER', entries: [] }), 'ERROR', null).state).toBe('unavailable');
    expect(parseSyncReport(report({ outcome: 'failed', code: 'OWNER_LIMIT_REACHED' }), 'ERROR', null).state).toBe('unavailable');
  });
});
