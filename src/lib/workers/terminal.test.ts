/**
 * portal#1492 (PT1) — a worker's terminal status in plain words. Every state and
 * reason the schema snapshot knows has a label; a value it does not know shows
 * fixed copy, never the raw code.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  terminalBadge,
  terminalCheckedAge,
  terminalLastTurn,
  terminalReasonLabel,
  terminalStateLabel,
  terminalSummary,
} from './terminal';

// portal#1495 (BLIND hygiene): resolved from this file, not the launcher's CWD.
const sdl = readFileSync(new URL('../../../schema/schema.graphql', import.meta.url), 'utf8');
function enumValues(name: string): string[] {
  const body = sdl.match(new RegExp(`enum ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? '';
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[a-z_]+$/.test(l));
}

const NOW = Date.parse('2026-10-31T12:00:00.000Z');

describe('labels', () => {
  it('reads the enums from the snapshot, so the test cannot go stale silently', () => {
    expect(enumValues('WorkerTerminalState').sort()).toEqual(['busy', 'dark', 'idle', 'locked']);
    expect(enumValues('WorkerTerminalReason').length).toBeGreaterThanOrEqual(11);
  });

  it.each(enumValues('WorkerTerminalState'))('state %s has a plain label, not its code', (s) => {
    const label = terminalStateLabel(s);
    expect(label).not.toBe('');
    expect(label).not.toBe('Unknown state');
    expect(label).not.toContain('_');
    expect(label.toLowerCase()).toBe(s);
  });

  it.each(enumValues('WorkerTerminalReason'))('reason %s has a plain label, not its code or the fallback', (r) => {
    const label = terminalReasonLabel(r);
    expect(label).not.toBe('Other reason');
    expect(label).not.toContain('_');
    expect(label).not.toBe(r);
  });

  it('keeps the agreed words for the common reasons', () => {
    expect(terminalReasonLabel('model_at_capacity')).toBe('Model at capacity');
    expect(terminalReasonLabel('menu_or_question')).toBe('Waiting at a menu or question');
    // portal#1938 (Holger): "Tickers" is the official name; supersedes the portal#1495 "wake-up is the reader-facing word" ruling. A single missed wake is not a missed ticker (cor:agt:080:15).
    expect(terminalReasonLabel('no_turn_for_due_ticker')).toBe('Missed its ticker wake');
  });

  it('an unknown state or reason shows fixed copy and logs nothing', () => {
    const spies = (['log', 'warn', 'error', 'info', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    expect(terminalStateLabel('quantum')).toBe('Unknown state');
    expect(terminalReasonLabel('solar_flare')).toBe('Other reason');
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });
});

describe('terminalBadge', () => {
  const read = { status: 'locked', reason: 'model_at_capacity', checkedAt: '2026-10-31T11:55:00.000Z' };

  it('a visible reader with a returned null terminal sees Not reported', () => {
    expect(terminalBadge(null, true)).toMatchObject({ state: 'not-reported', label: 'Not reported' });
  });

  it('absent (no roster entry, failed or unselected read) is no badge, apart from a returned null', () => {
    expect(terminalBadge(undefined, true)).toBeNull();
    expect(terminalBadge(null, true)).not.toBeNull();
  });

  it('a reader without internals sees nothing, even for a terminal object or null', () => {
    expect(terminalBadge(read, false)).toBeNull();
    expect(terminalBadge(null, false)).toBeNull();
  });

  it.each([
    ['idle', null, 'Idle'],
    ['busy', null, 'Busy'],
    ['locked', 'model_at_capacity', 'Locked: Model at capacity'],
    ['dark', 'no_turn_for_due_ticker', 'Dark: Missed its ticker wake'],
  ])('%s with %s reads %s', (status, reason, summary) => {
    const b = terminalBadge({ status, reason, checkedAt: read.checkedAt }, true)!;
    expect(terminalSummary(b)).toBe(summary);
  });

  it('an unknown state or reason keeps the fixed copy in the summary', () => {
    const b = terminalBadge({ status: 'quantum', reason: 'solar_flare', checkedAt: read.checkedAt }, true)!;
    expect(b.state).toBe('unknown');
    expect(terminalSummary(b)).toBe('Unknown state: Other reason');
    expect(terminalSummary(b)).not.toContain('solar');
    expect(terminalSummary(b)).not.toContain('quantum');
  });

  it('a stale report keeps its server state: age never derives dark or idle', () => {
    const b = terminalBadge({ status: 'busy', reason: null, checkedAt: '2026-10-01T00:00:00.000Z' }, true)!;
    expect(b.state).toBe('busy');
    expect(terminalSummary(b)).toBe('Busy');
  });
});

describe('age', () => {
  it('says how long ago it was checked, and nothing else', () => {
    expect(terminalCheckedAge('2026-10-31T11:55:00.000Z', NOW)).toMatch(/^checked .*ago$/);
    expect(terminalCheckedAge('2026-10-01T00:00:00.000Z', NOW)).toMatch(/^checked .*ago$/);
  });
  it('a future, missing or unparsable checkedAt is time unknown', () => {
    expect(terminalCheckedAge('2026-10-31T13:00:00.000Z', NOW)).toBe('checked: time unknown');
    expect(terminalCheckedAge('not a date', NOW)).toBe('checked: time unknown');
    expect(terminalCheckedAge(null, NOW)).toBe('checked: time unknown');
  });
  it('a null, future or unparsable lastTurnAt is not known', () => {
    expect(terminalLastTurn(null, NOW)).toBe('Last turn: not known');
    expect(terminalLastTurn('2026-10-31T13:00:00.000Z', NOW)).toBe('Last turn: not known');
    expect(terminalLastTurn('nope', NOW)).toBe('Last turn: not known');
    expect(terminalLastTurn('2026-10-31T11:00:00.000Z', NOW)).toMatch(/^Last turn: .*ago$/);
  });

  // portal#1495 P2 — a report a moment ahead of the page clock is skew, not a
  // lie: the server accepts a checkedAt up to 120 s ahead when written, so a
  // viewer whose clock trails by a second would otherwise read "time unknown"
  // on the freshest report there is. Display grace: exactly 60 s, inclusive,
  // clamped to the zero-age word. Never "in N sec.". Beyond it: unknown, and
  // nothing about the stored report changes (issue gate 6568261816, Vera FIT
  // 6568235885 — a client display policy, not server invalidity).
  describe('a future instant within a 60-second grace reads as now (portal#1495)', () => {
    const ahead = (ms: number) => new Date(NOW + ms).toISOString();
    it('a checkedAt 1 s ahead reads "checked now", never future wording', () => {
      expect(terminalCheckedAge(ahead(1_000), NOW)).toBe('checked now');
    });
    it('the grace is inclusive at exactly 60 s', () => {
      expect(terminalCheckedAge(ahead(60_000), NOW)).toBe('checked now');
    });
    it('one millisecond past the grace is time unknown again', () => {
      expect(terminalCheckedAge(ahead(60_001), NOW)).toBe('checked: time unknown');
    });
    it('a lastTurnAt gets the same inclusive grace: "Last turn: now" inside, "not known" beyond', () => {
      expect(terminalLastTurn(ahead(1_000), NOW)).toBe('Last turn: now');
      expect(terminalLastTurn(ahead(60_000), NOW)).toBe('Last turn: now');
      expect(terminalLastTurn(ahead(60_001), NOW)).toBe('Last turn: not known');
    });
  });
});
