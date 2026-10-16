/**
 * portal#1099 — the Wake-ups tab's one sentence (design §4.1), every row,
 * plus the never-due cases of hrn:node:hadronmemory.com:specs:cor:agt:080:11
 * (dormant per :07), which Xavier's stamp asks to be pinned explicitly.
 */
import { describe, expect, it } from 'vitest';
import { wakeStatus } from './wake';
import type { WakeSubscription, WorkerWakeSettings } from './types';

const NOW = Date.parse('2026-10-16T10:00:00Z');
const sub = (enabled = true, cadenceSeconds = 600): WakeSubscription => ({
  id: `s-${enabled}-${cadenceSeconds}`,
  createdAt: '2026-10-15T00:00:00Z',
  createdBy: null,
  viaGrant: false,
  ticker: { id: 't', name: 'engineering', urn: null, enabled, cadenceSeconds, quietHours: null },
});
const settings = (over: Partial<WorkerWakeSettings> = {}): WorkerWakeSettings => ({
  mentions: 'IMMEDIATE',
  pausedUntil: null,
  dormant: false,
  effectiveCadenceSeconds: null,
  subscriptions: [],
  ...over,
});
const live = { retiredAt: null };

describe('wakeStatus (design §4.1)', () => {
  it('a retired worker is never woken, whatever else is set', () => {
    const s = wakeStatus(settings({ dormant: true, effectiveCadenceSeconds: 600, subscriptions: [sub()] }), { retiredAt: '2026-10-01T00:00:00Z' }, NOW);
    expect(s.kind).toBe('retired');
    expect(s.text).toBe('Retired: never woken.');
  });

  // hrn:node:hadronmemory.com:specs:cor:agt:080:07 / :11 — Xavier's stamp: pin the dormant case explicitly.
  it('a DORMANT worker is not woken, even with mentions on and a live subscription', () => {
    const s = wakeStatus(settings({ dormant: true, effectiveCadenceSeconds: 600, subscriptions: [sub()] }), live, NOW);
    expect(s.kind).toBe('dormant');
    expect(s.lead).toBe('Not woken: dormant.');
    expect(s.text).toContain('Mentions to it are counted, not dropped');
    expect(s.text).toContain('woken again once a session is active');
  });

  it('dormant wins over a pause: the never-due reasons are checked in the spec’s order', () => {
    expect(wakeStatus(settings({ dormant: true, pausedUntil: '2026-10-17T00:00:00Z' }), live, NOW).kind).toBe('dormant');
  });

  it('a pause in the future stops everything, mentions included', () => {
    const s = wakeStatus(settings({ pausedUntil: '2026-10-16T12:00:00Z', effectiveCadenceSeconds: 600, subscriptions: [sub()] }), live, NOW);
    expect(s.kind).toBe('paused');
    expect(s.lead).toMatch(/^Paused until /);
    expect(s.text).toBe('Nothing wakes it until then, not even mentions.');
  });

  it('a pause that has ended doesn’t count', () => {
    expect(wakeStatus(settings({ pausedUntil: '2026-10-16T09:00:00Z' }), live, NOW).kind).toBe('mentions-only');
  });

  it('mentions off and no ticker: nothing wakes it', () => {
    const s = wakeStatus(settings({ mentions: 'OFF' }), live, NOW);
    expect(s.kind).toBe('nothing');
    expect(s.lead).toBe('Nothing wakes it.');
  });

  it('mentions off with a ticker: tickers only, at the effective cadence', () => {
    const s = wakeStatus(settings({ mentions: 'OFF', effectiveCadenceSeconds: 600, subscriptions: [sub()] }), live, NOW);
    expect(s.kind).toBe('tickers-only');
    expect(s.text).toContain('at most every 10 min');
    expect(s.text).toContain('Mentions don’t wake it.');
  });

  it('mentions on and no ticker: mentions only', () => {
    expect(wakeStatus(settings(), live, NOW).text).toBe('Woken at once when mentioned. No ticker wakes it for other unread messages.');
  });

  it('a subscription on a DISABLED ticker doesn’t count as a ticker that wakes it', () => {
    expect(wakeStatus(settings({ subscriptions: [sub(false)] }), live, NOW).kind).toBe('mentions-only');
  });

  it('mentions on with a ticker: both', () => {
    const s = wakeStatus(settings({ effectiveCadenceSeconds: 7200, subscriptions: [sub(true, 7200)] }), live, NOW);
    expect(s.kind).toBe('mentions-and-tickers');
    expect(s.text).toContain('at most every 2 h');
  });

  describe('anything the table doesn’t cover reads unknown, never another row’s sentence', () => {
    it('an unknown mentions mode', () => {
      const s = wakeStatus(settings({ mentions: 'ON_TICK' }), live, NOW);
      expect(s).toMatchObject({ kind: 'unknown', lead: 'Wake state unknown.' });
    });
    it('an unreadable pause', () => {
      expect(wakeStatus(settings({ pausedUntil: 'not a date' }), live, NOW).kind).toBe('unknown');
    });
    it('an effective cadence with no enabled subscription behind it', () => {
      expect(wakeStatus(settings({ effectiveCadenceSeconds: 600 }), live, NOW).kind).toBe('unknown');
    });
    it('an enabled subscription with no effective cadence', () => {
      expect(wakeStatus(settings({ subscriptions: [sub()] }), live, NOW).kind).toBe('unknown');
    });
  });
});
