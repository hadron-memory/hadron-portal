import type { ListPageNavigation } from '$lib/list-page';

/**
 * portal#2235 — the App's Questions list keeps all of its state in the URL, so a view can be linked. Each parameter has a
 * pure parser that reports "malformed" for anything it does not recognise; the loader canonicalises those with a 303.
 * Every filter, sort and page is a SERVER argument and none is applied in the browser, because a list's count and pages
 * agree with the worked-out state only when the server judges it (hrn:node:hadronmemory.com:specs:cor:dmo:140:09).
 */
export const QUESTIONS_PAGE_SIZE = 50;
const MAX_OFFSET = 2147483647;

export type StatusFilter = 'pending' | 'answered' | 'all';
export type AssigneeFilter = { kind: 'me' } | { kind: 'all' } | { kind: 'user'; id: string };
export type SortKey = 'priority' | 'newest' | 'oldest' | 'answered';
export type PriorityKey = 'low' | 'normal' | 'high' | 'urgent';

export type QuestionsFilter = {
  status: StatusFilter;
  assignee: AssigneeFilter;
  sort: SortKey;
  priority: readonly PriorityKey[];
  offset: number;
};

export const STATUS_FILTERS: readonly StatusFilter[] = ['pending', 'answered', 'all'];
export const SORT_KEYS: readonly SortKey[] = ['priority', 'newest', 'oldest', 'answered'];
/** In rank order, lowest first: the canonical order of a priority list. */
export const PRIORITY_KEYS: readonly PriorityKey[] = ['low', 'normal', 'high', 'urgent'];

export const DEFAULT_FILTER: QuestionsFilter = { status: 'pending', assignee: { kind: 'me' }, sort: 'priority', priority: [], offset: 0 };

export type Parsed<T> = { value: T; malformed: boolean };

export function parseStatus(raw: string | null): Parsed<StatusFilter> {
  if (raw === null) return { value: 'pending', malformed: false };
  return (STATUS_FILTERS as readonly string[]).includes(raw) ? { value: raw as StatusFilter, malformed: false } : { value: 'pending', malformed: true };
}

const USER_ID = /^[A-Za-z0-9_-]{1,64}$/;
export function parseAssignee(raw: string | null): Parsed<AssigneeFilter> {
  if (raw === null || raw === 'me') return { value: { kind: 'me' }, malformed: false };
  if (raw === 'all') return { value: { kind: 'all' }, malformed: false };
  return USER_ID.test(raw) ? { value: { kind: 'user', id: raw }, malformed: false } : { value: { kind: 'me' }, malformed: true };
}

export function parseSort(raw: string | null): Parsed<SortKey> {
  if (raw === null) return { value: 'priority', malformed: false };
  return (SORT_KEYS as readonly string[]).includes(raw) ? { value: raw as SortKey, malformed: false } : { value: 'priority', malformed: true };
}

/** An empty value is the form's "Any priority", the same as no parameter. */
export function parsePriorities(raw: string | null): Parsed<PriorityKey[]> {
  if (raw === null || raw === '') return { value: [], malformed: false };
  const parts = raw.split(',');
  if (!parts.every((p) => (PRIORITY_KEYS as readonly string[]).includes(p))) return { value: [], malformed: true };
  const set = new Set(parts);
  return { value: PRIORITY_KEYS.filter((p) => set.has(p)), malformed: false };
}

export function parseOffset(raw: string | null): Parsed<number> {
  if (raw === null) return { value: 0, malformed: false };
  if (!/^\d+$/.test(raw)) return { value: 0, malformed: true };
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= MAX_OFFSET ? { value: n, malformed: false } : { value: 0, malformed: true };
}

export function parseQuestionsFilter(params: URLSearchParams): { filter: QuestionsFilter; malformed: string[]; rewrite: Record<string, string>; canonical: boolean } {
  const status = parseStatus(params.get('status'));
  const assignee = parseAssignee(params.get('assignee'));
  const sort = parseSort(params.get('sort'));
  const priority = parsePriorities(params.get('priority'));
  const offset = parseOffset(params.get('offset'));
  const malformed = (
    [['status', status], ['assignee', assignee], ['sort', sort], ['priority', priority], ['offset', offset]] as const
  ).filter(([, p]) => p.malformed).map(([k]) => k);
  // A valid priority list in another order or with repeats names the same set (the filter matches as a set), so it is
  // rewritten to its canonical spelling rather than dropped: one view, one address.
  const rawPriority = params.get('priority');
  const rewrite: Record<string, string> = {};
  if (!priority.malformed && rawPriority && rawPriority !== priority.value.join(',')) rewrite.priority = priority.value.join(',');
  return {
    filter: { status: status.value, assignee: assignee.value, sort: sort.value, priority: priority.value, offset: offset.value },
    malformed,
    rewrite,
    canonical: malformed.length === 0 && Object.keys(rewrite).length === 0,
  };
}

const SORT_WIRE: Record<SortKey, string> = {
  priority: 'PRIORITY_DESC',
  newest: 'ASKED_AT_DESC',
  oldest: 'ASKED_AT_ASC',
  answered: 'ANSWERED_AT_DESC',
};

/**
 * The server's arguments for a filter (the issue's table). "Mine and unassigned" is the default because an unassigned
 * question is for every decider; with no known viewer it asks for everyone rather than invent an id.
 */
export function questionsServerArgs(filter: QuestionsFilter, viewerId: string | null): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  if (filter.status === 'pending') args.answered = false;
  else if (filter.status === 'answered') args.answered = true;
  if (filter.assignee.kind === 'me') {
    if (viewerId) { args.assigneeId = viewerId; args.unassigned = true; }
  } else if (filter.assignee.kind === 'user') {
    args.assigneeId = filter.assignee.id;
  }
  args.sort = SORT_WIRE[filter.sort];
  if (filter.priority.length > 0) args.priority = filter.priority.map((p) => p.toUpperCase());
  args.limit = QUESTIONS_PAGE_SIZE;
  args.offset = filter.offset;
  return args;
}

/** A link to a view: only what differs from the default is written, so the default view is the bare path. */
export function questionsHref(path: string, filter: QuestionsFilter, override: Partial<QuestionsFilter> = {}): string {
  const f = { ...filter, ...override };
  const q = new URLSearchParams();
  if (f.status !== DEFAULT_FILTER.status) q.set('status', f.status);
  if (f.assignee.kind === 'all') q.set('assignee', 'all');
  else if (f.assignee.kind === 'user') q.set('assignee', f.assignee.id);
  if (f.sort !== DEFAULT_FILTER.sort) q.set('sort', f.sort);
  if (f.priority.length > 0) q.set('priority', f.priority.join(','));
  if (f.offset > 0) q.set('offset', String(f.offset));
  const s = q.toString();
  return s ? `${path}?${s}` : path;
}

/**
 * Offset paging over the server's `total`. Next advances by the rows actually served; Previous steps back by the page
 * size, never by the count on this page, so a short last page does not creep back by its own length (#1868).
 */
export function questionsNavigation(path: string, filter: QuestionsFilter, count: number, total: number): ListPageNavigation {
  const next = filter.offset + count;
  return {
    offset: filter.offset,
    count,
    total: count > 0 ? Math.max(total, next) : total,
    firstHref: filter.offset > 0 ? questionsHref(path, filter, { offset: 0 }) : null,
    // From a page past the end (nothing served, rows exist) Previous lands on the last page that has rows, not on another empty one.
    previousHref: filter.offset > 0
      ? questionsHref(path, filter, {
          offset: count === 0 && total > 0
            ? Math.floor((total - 1) / QUESTIONS_PAGE_SIZE) * QUESTIONS_PAGE_SIZE
            : Math.max(0, filter.offset - QUESTIONS_PAGE_SIZE),
        })
      : null,
    nextHref: count > 0 && next < total && next <= MAX_OFFSET ? questionsHref(path, filter, { offset: next }) : null,
  };
}
