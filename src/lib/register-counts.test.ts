import { describe, expect, it } from 'vitest';
import { countsAsNewLabel } from './register-counts';

describe('countsAsNewLabel', () => {
  it('a POST-only row counts nothing, mention-only or not', () => {
    expect(countsAsNewLabel('POST', false)).toBe('Nothing (post only)');
    expect(countsAsNewLabel('POST', true)).toBe('Nothing (post only)');
  });
  it('WATCH and BOTH count all messages, or only mentions', () => {
    for (const role of ['WATCH', 'BOTH'] as const) {
      expect(countsAsNewLabel(role, false)).toBe('All messages');
      expect(countsAsNewLabel(role, true)).toBe('Only when mentioned');
    }
  });
});
