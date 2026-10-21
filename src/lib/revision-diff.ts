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
  /** Nothing newer is in the list; valid only if the live node is revision `liveRevision`. */
  | { kind: 'current'; liveRevision: number }
  | { kind: 'unknown' };

/**
 * What replaced revision `id`, given the node's History list (any order).
 *
 * Adjacent rows in the list are NOT adjacent snapshots: a snapshot can be
 * pruned, deleted, or filtered out of the list for a reader who cannot see the
 * memory it was captured in. The only reliable continuity signal is `revNo`, the
 * revision a snapshot captured. Snapshot N is replaced by the state at N+1, so:
 *
 *  - the successor is the row whose `revNo` is exactly N+1;
 *  - if no row is newer, the replacement is the live node, and only if the live
 *    node is at revision N+1 (the caller checks `liveRevision`).
 *
 * Anything else (the id is absent, a legacy row without `revNo`, a gap in the
 * numbers) is `unknown`: a diff there would span several edits, or skip some,
 * while being labelled as one.
 */
export function replacementOf(
  revisions: ReadonlyArray<{ id: string; revNo?: number | null }>,
  id: string,
): RevisionReplacement {
  const row = revisions.find((r) => r.id === id);
  if (!row || row.revNo == null) return { kind: 'unknown' };
  const successor = row.revNo + 1;
  const next = revisions.find((r) => r.revNo === successor);
  if (next) return { kind: 'revision', id: next.id };
  const anyNewer = revisions.some((r) => r.revNo != null && r.revNo > row.revNo!);
  // A newer row exists but not the adjacent one: the gap is a missing snapshot.
  if (anyNewer) return { kind: 'unknown' };
  return { kind: 'current', liveRevision: successor };
}

export type DiffLine = { kind: 'same' | 'added' | 'removed'; text: string };

/**
 * Largest body, per side, that is diffed. The diff runs in the loader, and a
 * line diff is superlinear in the worst case, so a huge node must not turn one
 * page view into a long CPU stall. Above it the page says so instead.
 */
export const MAX_DIFF_CHARS = 200_000;

/**
 * Work budget for the line diff itself. Length alone does not bound it: two
 * 5,000-line bodies with nothing in common stall a synchronous diff far below
 * MAX_DIFF_CHARS. `maxEditLength` caps the edit distance (in lines) the search
 * will explore and `timeout` is a wall-clock backstop; either makes jsdiff
 * give up, which is reported as `too-large`.
 */
const MAX_EDIT_LINES = 2_000;
const DIFF_TIMEOUT_MS = 300;

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
 * no read access), and the portal cannot tell them apart. So a null on EITHER
 * side is `unavailable`: one side withheld would show the other as wholly added
 * or removed, and two withheld bodies may differ, so "unchanged" is also a claim
 * nothing supports. Only a real `''` against `''` is a no-change.
 */
export function diffRevisionContent(
  before: string | null | undefined,
  after: string | null | undefined,
): ContentDiff {
  if (before == null || after == null) return { state: 'unavailable' };
  const a = before;
  const b = after;
  if (a === b) return { state: 'diff', changed: false, lines: [] };
  if (a.length > MAX_DIFF_CHARS || b.length > MAX_DIFF_CHARS) return { state: 'too-large' };
  const lines: DiffLine[] = [];
  // ignoreNewlineAtEof: appending after a last line that has no trailing
  // newline must not show that last line as removed and re-added.
  const parts = diffLines(a, b, {
    ignoreNewlineAtEof: true,
    maxEditLength: MAX_EDIT_LINES,
    timeout: DIFF_TIMEOUT_MS,
  });
  if (!parts) return { state: 'too-large' };
  if (!parts.some((p) => p.added || p.removed)) return { state: 'diff', changed: false, lines: [] };
  for (const part of parts) {
    const kind = part.added ? 'added' : part.removed ? 'removed' : 'same';
    // jsdiff keeps each line's terminator; the view draws one row per line.
    const text = part.value.endsWith('\n') ? part.value.slice(0, -1) : part.value;
    for (const line of text.split('\n')) lines.push({ kind, text: line });
  }
  return { state: 'diff', changed: true, lines };
}
