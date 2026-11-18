import type { BoardFilter } from './status';

/**
 * portal#1427 — what the board narrows by besides its status bucket and text:
 * Overdue and tags. Both AND with the bucket and the search, and both live in
 * the URL.
 *
 * Overdue is the server's definition (hadron-server#4220, implementing #2654:
 * a pending, not-started task past its start-by, or a pending-or-started task
 * past its finish-by and not ended; backlog never — all on the database clock);
 * the portal never recomputes it from `startBy` to filter. Tags mean ALL of the
 * listed tags, because every other control on the board narrows and a second
 * tag should too.
 */
export type BoardNarrow = { overdue: boolean; tags: string[]; unresolved: boolean };

export const NO_NARROW: BoardNarrow = { overdue: false, tags: [], unresolved: false };

/**
 * portal#1643 (hadron-server#2663): "unresolved findings" narrows to FINISHED tasks with at least one
 * finding no one has disposed of yet, in the existing App read scope and before paging. Only the
 * Ended and All buckets can hold a finished task, so the others could only ever show an empty board.
 */
export function unresolvedApplies(filter: BoardFilter): boolean {
  return filter === 'ended' || filter === 'all';
}

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
export function parseNarrow(params: URLSearchParams, filter: BoardFilter): { narrow: BoardNarrow; overdueDropped: boolean; unresolvedDropped: boolean } {
  const asked = params.get('overdue') === '1';
  const overdue = asked && overdueApplies(filter);
  const askedUnresolved = params.get('unresolved') === '1';
  const unresolved = askedUnresolved && unresolvedApplies(filter);
  return { narrow: { overdue, tags: parseTags(params.get('tags')), unresolved }, overdueDropped: asked && !overdue, unresolvedDropped: askedUnresolved && !unresolved };
}

/** The server arguments: only what is set, and `overdue` only ever as `true`. */
export function narrowArgs(n: BoardNarrow): { overdue?: true; tagsAll?: string[]; unresolvedFindings?: true; rootsOnly?: false } {
  return {
    ...(n.overdue ? { overdue: true as const } : {}),
    ...(n.tags.length ? { tagsAll: n.tags } : {}),
    // A finished subtask carries findings too, and the board reads roots only: list them across the tree.
    ...(n.unresolved ? { unresolvedFindings: true as const, rootsOnly: false as const } : {}),
  };
}
