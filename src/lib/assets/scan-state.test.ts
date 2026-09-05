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
import { downloadTitle, scanLabel, scanSignatureText, type ScanStatus } from './scan-state';

const ALL: ScanStatus[] = ['CLEAN', 'PENDING', 'BLOCKED'];

describe('downloadTitle', () => {
  it('promises later availability for PENDING, which is retried indefinitely', () => {
    expect(downloadTitle('PENDING')).toMatch(/once the malware scan finishes/i);
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
