/**
 * #1001 — what the edit that replaced a revision changed.
 *
 * A NodeRevision is the PRE-edit snapshot (hrn:node:hadronmemory.com:specs:cor:dmo:060:04), so
 * the change an edit made is the diff from that snapshot to whatever replaced
 * it: the next-newer snapshot, or the live node when this is the newest.
 */
import { describe, expect, it } from 'vitest';
import { MAX_DIFF_CHARS, diffRevisionContent, replacementOf } from './revision-diff';

const rev = (id: string, revNo: number | null) => ({ id, revNo });

describe('replacementOf', () => {
  // revNo N is the snapshot of revision N, replaced by the state at N+1.
  const list = [rev('c', 3), rev('b', 2), rev('a', 1)];

  it('is the snapshot whose revNo is exactly one higher', () => {
    expect(replacementOf(list, 'a')).toEqual({ kind: 'revision', id: 'b' });
    expect(replacementOf(list, 'b')).toEqual({ kind: 'revision', id: 'c' });
  });

  it('is the live node, expected at revNo+1, for the newest snapshot', () => {
    expect(replacementOf(list, 'c')).toEqual({ kind: 'current', liveRevision: 4 });
  });

  it('does not depend on list order', () => {
    expect(replacementOf([list[2], list[0], list[1]], 'a')).toEqual({ kind: 'revision', id: 'b' });
  });

  it('is unknown when the revision is not in the list (pruned or beyond the page)', () => {
    expect(replacementOf(list, 'zzz')).toEqual({ kind: 'unknown' });
  });

  // A pruned or filtered-out middle snapshot must not make r1 -> r3 look like one edit.
  it('is unknown across a gap in the revision numbers', () => {
    expect(replacementOf([rev('c', 3), rev('a', 1)], 'a')).toEqual({ kind: 'unknown' });
  });

  it('is unknown for a legacy row with no revNo', () => {
    expect(replacementOf([rev('c', 3), rev('a', null)], 'a')).toEqual({ kind: 'unknown' });
  });
});

describe('diffRevisionContent', () => {
  it('marks added and removed lines and keeps unchanged ones', () => {
    const d = diffRevisionContent('one\ntwo\nthree\n', 'one\n2\nthree\nfour\n');
    expect(d).toMatchObject({ state: 'diff', changed: true });
    if (d.state !== 'diff') throw new Error('unreachable');
    expect(d.lines.map((l) => [l.kind, l.text])).toEqual([
      ['same', 'one'],
      ['removed', 'two'],
      ['added', '2'],
      ['same', 'three'],
      ['added', 'four'],
    ]);
  });

  it('reports no change for identical content, empty included', () => {
    expect(diffRevisionContent('a\nb', 'a\nb')).toEqual({ state: 'diff', changed: false, lines: [] });
    expect(diffRevisionContent('', '')).toEqual({ state: 'diff', changed: false, lines: [] });
  });

  // Two withheld bodies may differ; null cannot prove equality.
  it('refuses to compare two absent bodies rather than call them unchanged', () => {
    expect(diffRevisionContent(null, undefined)).toEqual({ state: 'unavailable' });
    expect(diffRevisionContent(null, null)).toEqual({ state: 'unavailable' });
  });

  // Withheld (encrypted / no read access) and empty both arrive as null; a
  // one-sided null must not read as "everything added" or "everything removed".
  it('refuses to compare when exactly one side has no readable content', () => {
    expect(diffRevisionContent(null, 'x')).toEqual({ state: 'unavailable' });
    expect(diffRevisionContent('x', null)).toEqual({ state: 'unavailable' });
    expect(diffRevisionContent(undefined, 'x')).toEqual({ state: 'unavailable' });
  });

  it('compares a real empty string with text (that one is a genuine empty body)', () => {
    const d = diffRevisionContent('', 'x');
    expect(d).toMatchObject({ state: 'diff', changed: true });
  });

  it('bounds the work: a side over the cap is too-large, at the cap is diffed', () => {
    const big = 'x'.repeat(MAX_DIFF_CHARS + 1);
    expect(diffRevisionContent(big, 'y')).toEqual({ state: 'too-large' });
    expect(diffRevisionContent('y', big)).toEqual({ state: 'too-large' });
    expect(diffRevisionContent('x'.repeat(MAX_DIFF_CHARS), 'y')).toMatchObject({ state: 'diff' });
  });

  it('ignores a difference only in the final newline', () => {
    expect(diffRevisionContent('a', 'a\n')).toEqual({ state: 'diff', changed: false, lines: [] });
  });

  // QA #1187: appending after a last line with no trailing newline showed that
  // line as removed and re-added.
  it('does not show the old last line as changed when text is appended after it', () => {
    const d = diffRevisionContent('one\ntwo', 'one\ntwo\nthree');
    if (d.state !== 'diff') throw new Error('unreachable');
    expect(d.lines.map((l) => [l.kind, l.text])).toEqual([
      ['same', 'one'],
      ['same', 'two'],
      ['added', 'three'],
    ]);
  });

  // Gene on #1187: a 28,889-char pair stalled a synchronous diff for >2s.
  it('gives up on a pair with nothing in common instead of stalling', () => {
    const lines = (p: string) => Array.from({ length: 5000 }, (_, i) => `${p}${i}`).join('\n');
    const t0 = Date.now();
    expect(diffRevisionContent(lines('a'), lines('b'))).toEqual({ state: 'too-large' });
    expect(Date.now() - t0).toBeLessThan(1500);
  });

  it('still diffs a large body with a small edit', () => {
    const base = Array.from({ length: 5000 }, (_, i) => `line ${i}`);
    const edited = [...base];
    edited[2500] = 'changed';
    const d = diffRevisionContent(base.join('\n'), edited.join('\n'));
    expect(d).toMatchObject({ state: 'diff', changed: true });
  });
});
