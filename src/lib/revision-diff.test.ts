/**
 * #1001 — what the edit that replaced a revision changed.
 *
 * A NodeRevision is the PRE-edit snapshot (hrn:node:hadronmemory.com:specs:cor:dmo:060:04), so
 * the change an edit made is the diff from that snapshot to whatever replaced
 * it: the next-newer snapshot, or the live node when this is the newest.
 */
import { describe, expect, it } from 'vitest';
import { diffRevisionContent, replacementOf } from './revision-diff';

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
    expect(d.changed).toBe(true);
    expect(d.lines.map((l) => [l.kind, l.text])).toEqual([
      ['same', 'one'],
      ['removed', 'two'],
      ['added', '2'],
      ['same', 'three'],
      ['added', 'four'],
    ]);
  });

  it('reports no change for identical content', () => {
    expect(diffRevisionContent('a\nb', 'a\nb')).toEqual({ changed: false, lines: [] });
  });

  it('treats null content as empty', () => {
    const d = diffRevisionContent(null, 'x');
    expect(d.lines.map((l) => l.kind)).toEqual(['added']);
    expect(diffRevisionContent(null, '')).toEqual({ changed: false, lines: [] });
  });

  it('keeps a final line without a trailing newline distinct from one with it', () => {
    expect(diffRevisionContent('a', 'a\n').changed).toBe(true);
  });
});
