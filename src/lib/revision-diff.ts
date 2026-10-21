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

/** Line diff of two content bodies; `changed` is false when they are identical. */
export function diffRevisionContent(
  before: string | null | undefined,
  after: string | null | undefined,
): { changed: boolean; lines: DiffLine[] } {
  const a = before ?? '';
  const b = after ?? '';
  if (a === b) return { changed: false, lines: [] };
  const lines: DiffLine[] = [];
  for (const part of diffLines(a, b)) {
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'same';
    // jsdiff keeps each line's terminator; the view draws one row per line.
    const text = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;
    for (const line of text.split('\n')) lines.push({ kind, text: line });
  }
  return { changed: true, lines };
}
