/**
 * portal#1571 — the hand-back reasons (hrn:node:hadronmemory.com:specs:cor:agt:050:29, :01).
 * The five codes are the server's closed set (AgentTaskHandBackCode); each has one plain label.
 */
import { describe, expect, it } from 'vitest';
import { HAND_BACK_CODES, HAND_BACK_TEXT_MAX, handBackLabel, parseHandBack } from './hand-back';

describe('hand-back reasons', () => {
  it('lists the five codes with their labels, in the server’s set', () => {
    expect(HAND_BACK_CODES.map((c) => [c.code, c.label])).toEqual([
      ['MISSING_INPUT', 'Missing input'],
      ['CANNOT_DO', 'Can’t do it'],
      ['REFUSED', 'Refused'],
      ['OUT_OF_SCOPE', 'Out of scope'],
      ['DUPLICATE', 'Duplicate'],
    ]);
  });

  it('labels a code, and shows an unknown one as itself rather than hiding it', () => {
    expect(handBackLabel('OUT_OF_SCOPE')).toBe('Out of scope');
    expect(handBackLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });

  it('caps the text at 2,000 characters', () => {
    expect(HAND_BACK_TEXT_MAX).toBe(2000);
  });

  it('needs a known code; the text is trimmed and blank is none', () => {
    expect(parseHandBack('', 'x')).toEqual({ invalid: { field: 'code', message: 'Choose a reason.' } });
    expect(parseHandBack('NOPE', '')).toMatchObject({ invalid: { field: 'code' } });
    expect(parseHandBack('REFUSED', '  \n ')).toEqual({ code: 'REFUSED' });
    expect(parseHandBack('REFUSED', '  needs the key  ')).toEqual({ code: 'REFUSED', text: 'needs the key' });
  });

  it('refuses text over the cap after trimming, and accepts exactly the cap', () => {
    expect(parseHandBack('REFUSED', 'x'.repeat(2000))).toEqual({ code: 'REFUSED', text: 'x'.repeat(2000) });
    expect(parseHandBack('REFUSED', ` ${'x'.repeat(2000)} `)).toEqual({ code: 'REFUSED', text: 'x'.repeat(2000) });
    expect(parseHandBack('REFUSED', 'x'.repeat(2001))).toMatchObject({ invalid: { field: 'text' } });
  });
});
