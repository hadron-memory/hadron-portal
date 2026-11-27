/**
 * portal#2235 — the Questions list's URL state. Each parameter parses to its default when absent, to its value when valid, and
 * reports malformed for anything else; the mapping to server arguments is the issue's table.
 */
import { describe, expect, it } from 'vitest';
import {
  QUESTIONS_PAGE_SIZE,
  parseAssignee,
  parseOffset,
  parsePriorities,
  parseQuestionsFilter,
  parseSort,
  parseStatus,
  questionsHref,
  questionsNavigation,
  questionsServerArgs,
} from './filters';

describe('status', () => {
  it('defaults to pending when absent', () => expect(parseStatus(null)).toEqual({ value: 'pending', malformed: false }));
  it.each(['pending', 'answered', 'all'] as const)('reads %s', (s) => expect(parseStatus(s)).toEqual({ value: s, malformed: false }));
  it.each(['bogus', 'PENDING', ' answered'])('reports %j as malformed and falls back to pending', (s) =>
    expect(parseStatus(s)).toEqual({ value: 'pending', malformed: true }));
});

describe('assignee', () => {
  it('defaults to me when absent', () => expect(parseAssignee(null)).toEqual({ value: { kind: 'me' }, malformed: false }));
  it('reads me, all and a user id', () => {
    expect(parseAssignee('me').value).toEqual({ kind: 'me' });
    expect(parseAssignee('all').value).toEqual({ kind: 'all' });
    expect(parseAssignee('u-42')).toEqual({ value: { kind: 'user', id: 'u-42' }, malformed: false });
  });
  it.each(['a b', 'x'.repeat(65), 'a/b', '<script>'])('reports %j as malformed and falls back to me', (s) =>
    expect(parseAssignee(s)).toEqual({ value: { kind: 'me' }, malformed: true }));
});

describe('sort', () => {
  it('defaults to priority when absent', () => expect(parseSort(null)).toEqual({ value: 'priority', malformed: false }));
  it.each(['priority', 'newest', 'oldest', 'answered'] as const)('reads %s', (s) => expect(parseSort(s)).toEqual({ value: s, malformed: false }));
  it('reports anything else as malformed', () => expect(parseSort('date')).toEqual({ value: 'priority', malformed: true }));
});

describe('priority', () => {
  it('is empty when absent', () => expect(parsePriorities(null)).toEqual({ value: [], malformed: false }));
  it('treats an empty value (the form’s "Any") as absent, not malformed', () => expect(parsePriorities('')).toEqual({ value: [], malformed: false }));
  it('reads a comma-separated list, in rank order and without repeats', () => {
    expect(parsePriorities('urgent,high,high')).toEqual({ value: ['high', 'urgent'], malformed: false });
    expect(parsePriorities('low')).toEqual({ value: ['low'], malformed: false });
  });
  it.each(['high,extreme', 'HIGH', 'high,,low', ','])('reports %j as malformed and drops the filter', (s) =>
    expect(parsePriorities(s)).toEqual({ value: [], malformed: true }));
});

describe('offset', () => {
  it('defaults to 0 when absent', () => expect(parseOffset(null)).toEqual({ value: 0, malformed: false }));
  it('reads a non-negative integer', () => expect(parseOffset('50')).toEqual({ value: 50, malformed: false }));
  it.each(['-1', '1.5', 'abc', '', '99999999999'])('reports %j as malformed and falls back to 0', (s) =>
    expect(parseOffset(s)).toEqual({ value: 0, malformed: true }));
});

describe('non-canonical priority lists (portal#2664)', () => {
  it('a valid list in another order or with repeats is rewritten to its canonical spelling, not dropped', () => {
    const a = parseQuestionsFilter(new URLSearchParams('priority=urgent,low'));
    expect(a.canonical).toBe(false);
    expect(a.rewrite).toEqual({ priority: 'low,urgent' });
    expect(a.malformed).toEqual([]);
    expect(a.filter.priority).toEqual(['low', 'urgent']);
    expect(parseQuestionsFilter(new URLSearchParams('priority=low,low')).rewrite).toEqual({ priority: 'low' });
  });
  it('a canonical or absent list needs no rewrite', () => {
    expect(parseQuestionsFilter(new URLSearchParams('priority=low,urgent')).rewrite).toEqual({});
    expect(parseQuestionsFilter(new URLSearchParams('')).rewrite).toEqual({});
    expect(parseQuestionsFilter(new URLSearchParams('priority=')).rewrite).toEqual({});
  });
  it('the spellings match the same questions: they send the same server arguments', () => {
    const args = (q: string) => questionsServerArgs(parseQuestionsFilter(new URLSearchParams(q)).filter, 'u1');
    expect(args('priority=urgent,low')).toEqual(args('priority=low,urgent'));
    expect(args('priority=low,low')).toEqual(args('priority=low'));
  });
});

describe('the whole URL', () => {
  it('is canonical when every value is absent or valid', () => {
    const r = parseQuestionsFilter(new URLSearchParams('status=answered&sort=newest'));
    expect(r.canonical).toBe(true);
    expect(r.filter).toMatchObject({ status: 'answered', sort: 'newest', assignee: { kind: 'me' }, priority: [], offset: 0 });
  });
  it('says which parameters are malformed so the loader can redirect without them', () => {
    const r = parseQuestionsFilter(new URLSearchParams('status=bogus&offset=-3&sort=newest'));
    expect(r.canonical).toBe(false);
    expect(r.malformed.sort()).toEqual(['offset', 'status']);
  });
});

describe('server arguments (the issue’s table)', () => {
  const base = { status: 'pending', assignee: { kind: 'me' }, sort: 'priority', priority: [], offset: 0 } as const;
  it('default: pending, mine and unassigned, by priority, no priority key', () => {
    const args = questionsServerArgs({ ...base }, 'u1');
    expect(args).toEqual({ answered: false, assigneeId: 'u1', unassigned: true, sort: 'PRIORITY_DESC', limit: 50, offset: 0 });
    expect(args).not.toHaveProperty('priority');
  });
  it('answered, everyone, newest, two priorities, a later page: no assignee keys at all', () => {
    const args = questionsServerArgs({ status: 'answered', assignee: { kind: 'all' }, sort: 'newest', priority: ['high', 'urgent'], offset: 50 }, 'u1');
    expect(args).toEqual({ answered: true, sort: 'ASKED_AT_DESC', priority: ['HIGH', 'URGENT'], offset: 50, limit: 50 });
    expect(args).not.toHaveProperty('assigneeId');
    expect(args).not.toHaveProperty('unassigned');
  });
  it('another member: that assigneeId and no unassigned', () => {
    const args = questionsServerArgs({ ...base, assignee: { kind: 'user', id: 'u2' } }, 'u1');
    expect(args).toMatchObject({ assigneeId: 'u2' });
    expect(args).not.toHaveProperty('unassigned');
  });
  it('status all sends no answered key', () => expect(questionsServerArgs({ ...base, status: 'all' }, 'u1')).not.toHaveProperty('answered'));
  it.each([['priority', 'PRIORITY_DESC'], ['newest', 'ASKED_AT_DESC'], ['oldest', 'ASKED_AT_ASC'], ['answered', 'ANSWERED_AT_DESC']] as const)(
    'sort %s is %s', (sort, wire) => expect(questionsServerArgs({ ...base, sort }, 'u1').sort).toBe(wire));
  it('page size is 50', () => expect(QUESTIONS_PAGE_SIZE).toBe(50));
  it('"me" with no known viewer asks for everyone rather than inventing an id', () => {
    const args = questionsServerArgs({ ...base }, null);
    expect(args).not.toHaveProperty('assigneeId');
    expect(args).not.toHaveProperty('unassigned');
  });
});

describe('links', () => {
  const f = { status: 'pending', assignee: { kind: 'me' }, sort: 'priority', priority: [], offset: 0 } as const;
  it('a default view links to the bare path', () => expect(questionsHref('/app/apps/a1/questions', f)).toBe('/app/apps/a1/questions'));
  it('carries only what differs from the default', () => {
    expect(questionsHref('/p', { ...f, status: 'all', priority: ['high'], offset: 50 })).toBe('/p?status=all&priority=high&offset=50');
    expect(questionsHref('/p', { ...f, assignee: { kind: 'all' } }, { status: 'answered' })).toBe('/p?status=answered&assignee=all');
  });
  it('a status link starts again from the first page', () => expect(questionsHref('/p', { ...f, offset: 100 }, { status: 'answered', offset: 0 })).toBe('/p?status=answered'));
});

describe('paging', () => {
  const f = { status: 'pending', assignee: { kind: 'me' }, sort: 'priority', priority: [], offset: 0 } as const;
  it('first page of 120: next only', () => {
    const n = questionsNavigation('/p', f, 50, 120);
    expect(n).toMatchObject({ offset: 0, count: 50, total: 120, previousHref: null, nextHref: '/p?offset=50' });
  });
  it('middle page: previous steps back by the page size', () => {
    const n = questionsNavigation('/p', { ...f, offset: 100 }, 20, 120);
    expect(n.previousHref).toBe('/p?offset=50');
    expect(n.nextHref).toBeNull();
  });
  it('a page past the end goes back to the last page with rows, not to another empty one', () => {
    expect(questionsNavigation('/p', { ...f, offset: 150 }, 0, 120).previousHref).toBe('/p?offset=100');
    expect(questionsNavigation('/p', { ...f, offset: 500 }, 0, 120).previousHref).toBe('/p?offset=100');
    expect(questionsNavigation('/p', { ...f, offset: 500 }, 0, 100).previousHref).toBe('/p?offset=50');
  });
});
