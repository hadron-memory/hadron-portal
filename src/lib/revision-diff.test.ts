/**
 * #1001 — what the edit that replaced a revision changed.
 *
 * A NodeRevision is the PRE-edit snapshot (hrn:node:hadronmemory.com:specs:cor:dmo:060:04), so
 * the change an edit made is the diff from that snapshot to whatever replaced
 * it: the next-newer snapshot, or the live node when this is the newest.
 */
import { describe, expect, it } from 'vitest';
import { MAX_DIFF_CHARS, diffRevisionContent, replacementOf } from './revision-diff';

const rev = (id: string, createdAt: string) => ({ id, createdAt });

describe('replacementOf', () => {
  // The History list is most-recent-first.
  const list = [rev('c', '2026-03-01'), rev('b', '2026-02-01'), rev('a', '2026-01-01')];

  it('is the next-NEWER snapshot for a middle revision', () => {
    expect(replacementOf(list, 'a')).toEqual({ kind: 'revision', id: 'b' });
    expect(replacementOf(list, 'b')).toEqual({ kind: 'revision', id: 'c' });
  });

  it('is the live node for the newest snapshot', () => {
    expect(replacementOf(list, 'c')).toEqual({ kind: 'current' });
  });

  it('is unknown when the revision is not in the list (pruned or beyond the page)', () => {
    expect(replacementOf(list, 'zzz')).toEqual({ kind: 'unknown' });
  });

  it('does not trust list order: it sorts by createdAt', () => {
    const shuffled = [list[2], list[0], list[1]];
    expect(replacementOf(shuffled, 'a')).toEqual({ kind: 'revision', id: 'b' });
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

  it('reports no change for two absent bodies', () => {
    expect(diffRevisionContent(null, undefined)).toEqual({ state: 'diff', changed: false, lines: [] });
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

  it('keeps a final line without a trailing newline distinct from one with it', () => {
    expect(diffRevisionContent('a', 'a\n')).toMatchObject({ changed: true });
  });
});
