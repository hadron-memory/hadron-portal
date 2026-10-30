/**
 * portal#1427 — the board's Overdue and tag filters: parsing a URL, the server
 * arguments, and the links that carry them.
 */
import { describe, expect, it } from 'vitest';
import { NO_NARROW, narrowArgs, overdueApplies, parseNarrow, parseTags } from './narrow';
import { taskBoardHref } from './search';

const q = (s: string) => new URLSearchParams(s);

describe('parseTags', () => {
  it('splits on commas, trims, drops blanks and repeats, keeps order', () => {
    expect(parseTags(' ops, infra ,,ops,  billing ')).toEqual(['ops', 'infra', 'billing']);
  });
  it('is empty for nothing', () => {
    expect(parseTags(null)).toEqual([]);
    expect(parseTags('  , ,')).toEqual([]);
  });
});

describe('overdueApplies', () => {
  it('only where an overdue task can exist: Active, Queued, All', () => {
    expect(['active', 'queued', 'all'].map((f) => overdueApplies(f as never))).toEqual([true, true, true]);
    expect(['ended', 'backlog'].map((f) => overdueApplies(f as never))).toEqual([false, false]);
  });
});

describe('parseNarrow', () => {
  it('unset is no narrowing', () => {
    expect(parseNarrow(q(''), 'active')).toEqual({ narrow: NO_NARROW, overdueDropped: false });
  });
  it('overdue is on only for the exact value 1; anything else falls back to unset', () => {
    expect(parseNarrow(q('overdue=1'), 'active').narrow.overdue).toBe(true);
    for (const v of ['0', 'true', 'false', '', 'yes']) expect(parseNarrow(q(`overdue=${v}`), 'active').narrow.overdue).toBe(false);
  });
  it('Ended and Backlog drop overdue and say so, never an empty board', () => {
    for (const f of ['ended', 'backlog'] as const) {
      expect(parseNarrow(q('overdue=1'), f)).toEqual({ narrow: NO_NARROW, overdueDropped: true });
    }
  });
  it('tags still apply in Ended and Backlog', () => {
    expect(parseNarrow(q('tags=ops&overdue=1'), 'ended')).toEqual({ narrow: { overdue: false, tags: ['ops'] }, overdueDropped: true });
  });
});

describe('narrowArgs', () => {
  it('sends nothing when unset', () => {
    expect(narrowArgs(NO_NARROW)).toEqual({});
  });
  it('sends overdue: true only, and tagsAll only when there are tags', () => {
    expect(narrowArgs({ overdue: true, tags: [] })).toEqual({ overdue: true });
    expect(narrowArgs({ overdue: false, tags: ['a', 'b'] })).toEqual({ tagsAll: ['a', 'b'] });
    expect('overdue' in narrowArgs({ overdue: false, tags: ['a'] })).toBe(false);
  });
});

describe('taskBoardHref carries the narrowing', () => {
  const base = '/app/apps/app-1';
  it('is unchanged when nothing is set', () => {
    expect(taskBoardHref(base, 'active', '')).toBe(`${base}/tasks`);
    expect(taskBoardHref(base, 'all', 'x', 'board', NO_NARROW)).toBe(`${base}/tasks?status=all&text=x`);
  });
  it('adds overdue=1 and a comma-joined tags value, encoded once', () => {
    expect(taskBoardHref(base, 'queued', '', 'board', { overdue: true, tags: ['a b', 'c'] }))
      .toBe(`${base}/tasks?status=queued&overdue=1&tags=a+b%2Cc`);
  });
});
