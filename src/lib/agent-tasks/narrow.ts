import type { BoardFilter } from './status';

/**
 * portal#1427 — what the board narrows by besides its status bucket and text:
 * Overdue and tags. Both AND with the bucket and the search, and both live in
 * the URL.
 *
 * Overdue is the server's definition (start-by passed on the database clock,
 * not started, not ended, not backlog); the portal never recomputes it from
 * `startBy` to filter. Tags mean ALL of the listed tags, because every other
 * control on the board narrows and a second tag should too.
 */
export type BoardNarrow = { overdue: boolean; tags: string[] };

export const NO_NARROW: BoardNarrow = { overdue: false, tags: [] };

/** Overdue excludes ended and backlog tasks, so those buckets could only ever show an empty board. */
export function overdueApplies(filter: BoardFilter): boolean {
  return filter === 'active' || filter === 'queued' || filter === 'all';
}

/** A comma-separated list: trimmed, blanks and repeats dropped, order kept. */
export function parseTags(raw: string | null): string[] {
  return [...new Set((raw ?? '').split(',').map((s) => s.trim()).filter(Boolean))];
}

/**
 * The narrowing a URL asks for, read defensively like `parseBoardFilter`:
 * Overdue is on only for the exact value `1`. In a bucket where it cannot
 * match it is dropped, and `overdueDropped` lets the page say so.
 */
export function parseNarrow(params: URLSearchParams, filter: BoardFilter): { narrow: BoardNarrow; overdueDropped: boolean } {
  const asked = params.get('overdue') === '1';
  const overdue = asked && overdueApplies(filter);
  return { narrow: { overdue, tags: parseTags(params.get('tags')) }, overdueDropped: asked && !overdue };
}

/** The server arguments: only what is set, and `overdue` only ever as `true`. */
export function narrowArgs(n: BoardNarrow): { overdue?: true; tagsAll?: string[] } {
  return { ...(n.overdue ? { overdue: true as const } : {}), ...(n.tags.length ? { tagsAll: n.tags } : {}) };
}
