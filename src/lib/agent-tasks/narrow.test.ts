/**
 * portal#1427 — the board's Overdue and tag filters: parsing a URL, the server
 * arguments, and the links that carry them.
 */
import { describe, expect, it } from 'vitest';
import { NO_NARROW, narrowArgs, overdueApplies, parseNarrow, parseTags, unresolvedApplies } from './narrow';
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
    expect(parseNarrow(q(''), 'active')).toEqual({ narrow: NO_NARROW, overdueDropped: false, unresolvedDropped: false });
  });
  it('overdue is on only for the exact value 1; anything else falls back to unset', () => {
    expect(parseNarrow(q('overdue=1'), 'active').narrow.overdue).toBe(true);
    for (const v of ['0', 'true', 'false', '', 'yes']) expect(parseNarrow(q(`overdue=${v}`), 'active').narrow.overdue).toBe(false);
  });
  it('Ended and Backlog drop overdue and say so, never an empty board', () => {
    for (const f of ['ended', 'backlog'] as const) {
      expect(parseNarrow(q('overdue=1'), f)).toEqual({ narrow: NO_NARROW, overdueDropped: true, unresolvedDropped: false });
    }
  });
  it('tags still apply in Ended and Backlog', () => {
    expect(parseNarrow(q('tags=ops&overdue=1'), 'ended')).toEqual({ narrow: { overdue: false, tags: ['ops'], unresolved: false }, overdueDropped: true, unresolvedDropped: false });
  });
});

describe('narrowArgs', () => {
  it('sends nothing when unset', () => {
    expect(narrowArgs(NO_NARROW)).toEqual({});
  });
  it('sends overdue: true only, and tagsAll only when there are tags', () => {
    expect(narrowArgs({ overdue: true, tags: [], unresolved: false })).toEqual({ overdue: true });
    expect(narrowArgs({ overdue: false, tags: ['a', 'b'], unresolved: false })).toEqual({ tagsAll: ['a', 'b'] });
    expect('overdue' in narrowArgs({ overdue: false, tags: ['a'], unresolved: false })).toBe(false);
  });
});

describe('taskBoardHref carries the narrowing', () => {
  const base = '/app/apps/app-1';
  it('is unchanged when nothing is set', () => {
    expect(taskBoardHref(base, 'active', '')).toBe(`${base}/tasks`);
    expect(taskBoardHref(base, 'all', 'x', 'board', NO_NARROW)).toBe(`${base}/tasks?status=all&text=x`);
  });
  it('adds overdue=1 and a comma-joined tags value, encoded once', () => {
    expect(taskBoardHref(base, 'queued', '', 'board', { overdue: true, tags: ['a b', 'c'], unresolved: false }))
      .toBe(`${base}/tasks?status=queued&overdue=1&tags=a+b%2Cc`);
  });
});

// portal#1643 (hadron-server#2663): finished tasks with an undisposed finding.
describe('unresolved findings', () => {
  it('applies only where a finished task can be: Ended and All', () => {
    expect((['active', 'queued', 'backlog', 'ended', 'all'] as const).filter(unresolvedApplies)).toEqual(['ended', 'all']);
  });
  it('is on only for the exact value 1, and only in those buckets', () => {
    expect(parseNarrow(q('unresolved=1'), 'ended').narrow.unresolved).toBe(true);
    expect(parseNarrow(q('unresolved=1'), 'all').narrow.unresolved).toBe(true);
    for (const v of ['0', 'true', '', 'yes']) expect(parseNarrow(q(`unresolved=${v}`), 'ended').narrow.unresolved).toBe(false);
  });
  it('is dropped, and says so, in a bucket that cannot hold a finished task', () => {
    for (const f of ['active', 'queued', 'backlog'] as const) expect(parseNarrow(q('unresolved=1'), f)).toMatchObject({ narrow: { unresolved: false }, unresolvedDropped: true });
    expect(parseNarrow(q('unresolved=1'), 'ended').unresolvedDropped).toBe(false);
  });
  it('asks the server for unresolvedFindings and lists subtasks too (the board is roots-only otherwise); unset sends neither', () => {
    expect(narrowArgs({ ...NO_NARROW, unresolved: true })).toEqual({ unresolvedFindings: true, rootsOnly: false });
    expect(narrowArgs(NO_NARROW)).toEqual({});
  });
  it('rides along every board link, so the next page reads it', () => {
    expect(taskBoardHref('/app/apps/a', 'ended', '', 'board', { ...NO_NARROW, unresolved: true })).toBe('/app/apps/a/tasks?status=ended&unresolved=1');
    expect(taskBoardHref('/app/apps/a', 'ended', '', 'board', NO_NARROW)).toBe('/app/apps/a/tasks?status=ended');
  });
});
