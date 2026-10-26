import { describe, expect, it } from 'vitest';
import { parseSyncReport, syncOutcomeMessage } from './sync-report';
import { parse, Kind } from 'graphql';
import { MEMORY_FIELDS, SYNC_MEMORY_MUTATION } from './server/queries';
const at = '2026-10-26T01:02:03.000Z';
const entry = { kind: 'held_move', loc: 'docs:new', fromLoc: 'docs:old', code: 'MOVE_HELD' };
const report = (over: Record<string, unknown> = {}) => JSON.stringify({ version: 1, outcome: 'partial', recordedAt: at, entries: [entry], ...over });
describe('stored sync report', () => {
  it.each(['partial', 'unknown', 'failed'])('accepts %s without guessing clean', (outcome) => {
    const raw = report({ outcome, ...(outcome === 'failed' ? { entries: [], code: 'SYNC_FAILED' } : {}) });
    expect(parseSyncReport(raw, 'OK', at).state).toBe(outcome);
    expect(syncOutcomeMessage({ lastSyncReport: raw, syncStatus: 'OK', lastSyncedAt: at }).text).not.toBe('Memory synced.');
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
    '{', 'null', '[]', report({ version: 2 }), report({ outcome: 'new' }), report({ outcome: ['partial'] }), report({ recordedAt: 'bad' }),
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
  it('selects the field in the real shared fragment and mutation; removal is red', () => {
    const selected = (source: string) => parse(source).definitions.some(d => d.kind === Kind.FRAGMENT_DEFINITION && d.name.value === 'MemoryFields' && d.selectionSet.selections.some(s => s.kind === Kind.FIELD && s.name.value === 'lastSyncReport'));
    expect(selected(MEMORY_FIELDS)).toBe(true);
    expect(selected(SYNC_MEMORY_MUTATION)).toBe(true);
    expect(selected(MEMORY_FIELDS.replace(/\blastSyncReport\b/g, 'syncError'))).toBe(false);
  });
});
