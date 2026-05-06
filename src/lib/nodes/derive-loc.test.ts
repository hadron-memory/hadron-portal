import { describe, expect, it } from 'vitest';
import { deriveChildLoc } from './derive-loc';

describe('deriveChildLoc', () => {
  it('joins parent loc and slugged title with a colon', () => {
    expect(deriveChildLoc('projects:alpha', 'My Sub Node')).toBe('projects:alpha:my-sub-node');
  });

  it('strips trailing colons from the parent loc', () => {
    expect(deriveChildLoc('projects:alpha:', 'Child')).toBe('projects:alpha:child');
    expect(deriveChildLoc('projects:alpha:::', 'Child')).toBe('projects:alpha:child');
  });

  it('returns a bare slug when the parent loc is empty (top-level child)', () => {
    expect(deriveChildLoc('', 'Child')).toBe('child');
    expect(deriveChildLoc(':', 'Child')).toBe('child');
  });

  it('lowercases via toSlug', () => {
    expect(deriveChildLoc('a', 'CamelCaseTitle')).toBe('a:camel-case-title');
  });

  it('strips punctuation and collapses spaces via toSlug', () => {
    expect(deriveChildLoc('a', '  Hello,   World!! ')).toBe('a:hello-world');
  });

  it('preserves digits in the title', () => {
    expect(deriveChildLoc('a', 'Q1 2026 Goals')).toBe('a:q1-2026-goals');
  });

  it('handles abbreviations and acronyms cleanly', () => {
    expect(deriveChildLoc('a', 'MMCoding Agent')).toBe('a:mm-coding-agent');
    expect(deriveChildLoc('a', 'SecureID Service')).toBe('a:secure-id-service');
  });

  it('throws when the title slugs to an empty string', () => {
    expect(() => deriveChildLoc('a', '')).toThrow(/empty slug/);
    expect(() => deriveChildLoc('a', '   ')).toThrow(/empty slug/);
    expect(() => deriveChildLoc('a', '!!!')).toThrow(/empty slug/);
  });
});
