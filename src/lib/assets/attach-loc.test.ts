/**
 * PR #697 review (codex): two assets whose filenames share a stem — `report.pdf`
 * and `report.docx` — both produced `<parent>:report`, so the second attach died
 * with a loc conflict the user had no way to resolve (the dialog has no loc
 * field).
 *
 * The fix is two-part and both parts are pinned here: fold the extension into the
 * atom, and walk a disambiguation ladder when the loc really is taken.
 */
import { describe, expect, it } from 'vitest';
import { attachLocAtom, attachCandidateLoc } from './attach-loc';

describe('attachLocAtom', () => {
  it('distinguishes files that differ only by extension', () => {
    // The reported case. Stripping the extension collapsed these onto one loc.
    expect(attachLocAtom('report.pdf')).not.toBe(attachLocAtom('report.docx'));
    expect(attachLocAtom('report.pdf')).toBe('report-pdf');
    expect(attachLocAtom('report.docx')).toBe('report-docx');
  });

  it('collapses characters that would change the loc’s shape', () => {
    // A loc is colon-delimited, so a literal ':' would silently add a tree level.
    expect(attachLocAtom('Q3: Final Notes.md')).toBe('q3-final-notes-md');
    expect(attachLocAtom('a/b\\c.txt')).toBe('a-b-c-txt');
  });

  it('trims separator runs from both ends', () => {
    expect(attachLocAtom('  spaced  .md ')).toBe('spaced-md');
    expect(attachLocAtom('---x---')).toBe('x');
  });

  it('caps length without leaving a trailing separator', () => {
    const atom = attachLocAtom(`${'a'.repeat(58)} b.md`);
    expect(atom.length).toBeLessThanOrEqual(60);
    expect(atom.endsWith('-')).toBe(false);
  });

  it('falls back to a usable atom when nothing survives', () => {
    // An all-punctuation name would otherwise yield '', producing a loc with an
    // empty trailing segment.
    expect(attachLocAtom('!!!')).toBe('file');
    expect(attachLocAtom('')).toBe('file');
  });

  it('is stable — the same filename always yields the same atom', () => {
    expect(attachLocAtom('notes.md')).toBe(attachLocAtom('notes.md'));
  });
});

describe('attachCandidateLoc', () => {
  it('uses the bare atom on the first attempt', () => {
    expect(attachCandidateLoc('report-pdf', 0)).toBe('report-pdf');
  });

  it('counts up from 2, so the ladder reads naturally', () => {
    // `report-pdf`, `report-pdf-2`, `report-pdf-3` — not `-1`, which would imply
    // a sibling `-0`.
    expect(attachCandidateLoc('report-pdf', 1)).toBe('report-pdf-2');
    expect(attachCandidateLoc('report-pdf', 2)).toBe('report-pdf-3');
  });

  it('never repeats a candidate across attempts', () => {
    const seen = new Set(
      Array.from({ length: 20 }, (_, i) => attachCandidateLoc('x', i)),
    );
    expect(seen.size).toBe(20);
  });
});
