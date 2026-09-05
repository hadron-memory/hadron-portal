/**
 * #707 — the per-scan-state copy.
 *
 * The defect these pin is that PENDING and BLOCKED shared one sentence,
 * *"Available once the malware scan passes"*, which is true of PENDING and
 * false of BLOCKED: `cor:dmo:060:12` makes BLOCKED terminal ("no later verdict
 * may overwrite it") and deletes the bytes, so nothing the user waits for can
 * arrive.
 */
import { describe, expect, it } from 'vitest';
import {
  downloadAriaLabel,
  downloadTitle,
  scanLabel,
  scanSignatureText,
  type ScanStatus,
} from './scan-state';

const ALL: ScanStatus[] = ['CLEAN', 'PENDING', 'BLOCKED'];

describe('downloadTitle', () => {
  // @codex P2 on #814. This spot has now had three wordings and the first two
  // were both promises:
  //
  //   "Available once the malware scan passes"   → false for BLOCKED
  //   "Available once the malware scan finishes" → false for a PENDING row that
  //                                                finishes BLOCKED
  //
  // A pending scan's completion is not the same event as its success, and only
  // the second makes the file downloadable. So PENDING may say the scan is
  // unsettled and that availability DEPENDS on the verdict — never that the
  // file is coming.
  it('PENDING states the scan is unfinished without promising the file arrives', () => {
    const title = downloadTitle('PENDING');
    expect(title).toMatch(/has not finished/i);
    expect(title).toMatch(/only if it passes/i);
  });

  it('PENDING does not promise availability on the scan merely COMPLETING', () => {
    const title = downloadTitle('PENDING');
    // Both retired wordings, kept as explicit counterexamples so a later edit
    // cannot reintroduce either without turning this red.
    expect(title).not.toMatch(/once the malware scan finishes/i);
    expect(title).not.toMatch(/once the malware scan passes/i);
    // Any unconditional "available …" is the shape of the defect.
    expect(title).not.toMatch(/^available/i);
  });

  it('does NOT promise later availability for BLOCKED — the verdict is terminal', () => {
    const title = downloadTitle('BLOCKED');
    // The exact defect: BLOCKED inheriting PENDING's sentence.
    expect(title).not.toMatch(/once the malware scan/i);
    expect(title).not.toMatch(/available/i);
    // And it must say the outcome is final, or a user simply waits anyway.
    expect(title).toMatch(/final/i);
  });

  it('gives every state its own sentence', () => {
    const seen = ALL.map(downloadTitle);
    expect(new Set(seen).size).toBe(ALL.length);
  });
});

describe('scanSignatureText', () => {
  it('names the signature on a blocked asset — the reason the tombstone is kept', () => {
    expect(scanSignatureText('BLOCKED', 'Eicar-Test-Signature')).toBe(
      'Signature: Eicar-Test-Signature',
    );
  });

  it('returns null for a blocked asset the scanner did not name', () => {
    // Deliberately null rather than "Signature: unknown": a placeholder reads as
    // a failed lookup, when the honest fact is that nothing was recorded.
    expect(scanSignatureText('BLOCKED', null)).toBeNull();
    expect(scanSignatureText('BLOCKED', '')).toBeNull();
  });

  it('never renders a signature for a non-blocked asset', () => {
    // A CLEAN row carrying a stale signature must not be described as blocked —
    // status is the fact, the signature is a detail hanging off it.
    expect(scanSignatureText('CLEAN', 'Eicar-Test-Signature')).toBeNull();
    expect(scanSignatureText('PENDING', 'Eicar-Test-Signature')).toBeNull();
  });
});

describe('scanLabel', () => {
  it('labels each state distinctly', () => {
    expect(new Set(ALL.map(scanLabel)).size).toBe(ALL.length);
    expect(scanLabel('BLOCKED')).toBe('Blocked');
  });
});

describe('downloadAriaLabel', () => {
  // @codex on #814: a disabled download button announced "Download notes.md"
  // while its reason lived only in `title`, so the fix for pointer users left
  // keyboard and screen-reader users with the same misleading affordance.
  it('names only the action for a clean asset', () => {
    expect(downloadAriaLabel('CLEAN', 'notes.md')).toBe('Download notes.md');
  });

  it('carries the reason for a pending asset', () => {
    const label = downloadAriaLabel('PENDING', 'notes.md');
    expect(label).toContain('notes.md');
    expect(label).toMatch(/only if it passes/i);
  });

  it('carries the reason AND the signature for a blocked asset', () => {
    const label = downloadAriaLabel('BLOCKED', 'notes.md', 'Eicar-Test-Signature');
    expect(label).toMatch(/final/i);
    expect(label).toContain('Eicar-Test-Signature');
  });

  it.each(['BLOCKED', 'PENDING'] as const)(
    'joins %s cleanly — no doubled period a screen reader reads as a stutter',
    (status) => {
      // The real defect, and the one my first pass missed: I asserted `. .` only
      // on the no-signature branch, where the join never runs. Both branches
      // that DO join are checked now.
      for (const sig of ['Eicar-Test-Signature', null]) {
        const label = downloadAriaLabel(status, 'notes.md', sig);
        expect(label).not.toMatch(/\.\s*\./);
        expect(label.trim()).toBe(label);
      }
    },
  );

  it('omits an absent signature without leaving an empty joined segment', () => {
    // The defect shape is a `. .` from joining an empty piece, not a trailing
    // period — the last sentence is meant to end in one. My first version of
    // this assertion rejected both and failed on correct output.
    const label = downloadAriaLabel('BLOCKED', 'notes.md', null);
    expect(label).not.toMatch(/\.\s*\./);
    expect(label).not.toContain('Signature:');
    expect(label.trim()).toBe(label);
  });
});
