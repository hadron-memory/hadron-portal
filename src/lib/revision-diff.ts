/**
 * #1001 — the change an edit made, read off the revision history.
 *
 * A NodeRevision is the **pre-edit** snapshot of a node
 * (hrn:node:hadronmemory.com:specs:cor:dmo:060:04). So the edit that replaced snapshot R is the diff
 * from R to whatever came next: the next-newer snapshot, or the live node when
 * R is the newest.
 */
import { diffLines } from 'diff';

export type RevisionReplacement =
  | { kind: 'revision'; id: string }
  | { kind: 'current' }
  | { kind: 'unknown' };

/**
 * What replaced revision `id`, given the node's History list (any order).
 * `unknown` when `id` is not in the list — pruned, or past the page the loader
 * fetched — because guessing "the live node" there would show a diff spanning
 * several edits as if it were one.
 */
export function replacementOf(
  revisions: ReadonlyArray<{ id: string; createdAt: string }>,
  id: string,
): RevisionReplacement {
  const newestFirst = [...revisions].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
  const at = newestFirst.findIndex((r) => r.id === id);
  if (at === -1) return { kind: 'unknown' };
  if (at === 0) return { kind: 'current' };
  return { kind: 'revision', id: newestFirst[at - 1].id };
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/**
 * Largest body, per side, that is diffed. The diff runs in the loader, and a
 * line diff is superlinear in the worst case, so a huge node must not turn one
 * page view into a long CPU stall. Above it the page says so instead.
 */
export const MAX_DIFF_CHARS = 200_000;

export type ContentDiff =
  | { state: 'diff'; changed: boolean; lines: DiffLine[] }
  /** One side has no readable content (empty, encrypted or withheld): not compared. */
  | { state: 'unavailable' }
  | { state: 'too-large' };

/**
 * Line diff of two content bodies.
 *
 * `null` is NOT treated as an empty string. The server returns no content both
 * for a genuinely empty node and for one it is withholding (encrypted memory,
 * no read access), and the portal cannot tell them apart. Diffing a withheld
 * side as "" would show the other side as wholly added or removed, which is a
 * false claim about the edit, so a one-sided null is `unavailable`. Two nulls
 * are a plain no-change.
 */
export function diffRevisionContent(
  before: string | null | undefined,
  after: string | null | undefined,
): ContentDiff {
  if (before == null && after == null) return { state: 'diff', changed: false, lines: [] };
  if (before == null || after == null) return { state: 'unavailable' };
  const a = before;
  const b = after;
  if (a === b) return { state: 'diff', changed: false, lines: [] };
  if (a.length > MAX_DIFF_CHARS || b.length > MAX_DIFF_CHARS) return { state: 'too-large' };
  const lines: DiffLine[] = [];
  for (const part of diffLines(a, b)) {
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'same';
    // jsdiff keeps each line's terminator; the view draws one row per line.
    const text = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;
    for (const line of text.split('\n')) lines.push({ kind, text: line });
  }
  return { state: 'diff', changed: true, lines };
}
