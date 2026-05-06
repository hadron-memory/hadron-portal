import { describe, expect, it } from 'vitest';
import { deriveDefaultLoc, slugify } from './derive-default-loc';

describe('slugify', () => {
  it('lowercases and converts whitespace to hyphens', () => {
    expect(slugify('Sort imports')).toBe('sort-imports');
  });

  it('lowercases mixed case', () => {
    expect(slugify('CamelCaseName')).toBe('camelcasename');
  });

  it('replaces underscores with hyphens', () => {
    expect(slugify('snake_case_name')).toBe('snake-case-name');
  });

  it('strips non-ASCII letters (umlauts, em-dash)', () => {
    expect(slugify('Über—Important')).toBe('berimportant');
  });

  it('strips punctuation', () => {
    expect(slugify("user's notes!")).toBe('users-notes');
  });

  it('collapses multiple separators', () => {
    expect(slugify('a   b___c')).toBe('a-b-c');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('  -leading and trailing-  ')).toBe('leading-and-trailing');
  });

  it('falls back to "untitled" for all-non-allowed input', () => {
    expect(slugify('!!!')).toBe('untitled');
    expect(slugify('   ')).toBe('untitled');
    expect(slugify('')).toBe('untitled');
  });
});

describe('deriveDefaultLoc', () => {
  it('returns the slugified name when no collision', () => {
    expect(deriveDefaultLoc('Sort imports', '', [])).toBe('sort-imports');
  });

  it('returns the slug under a parent when no collision at that parent', () => {
    expect(deriveDefaultLoc('Render URN', 'review', ['review:other-thing'])).toBe('render-urn');
  });

  it('appends -2 on first collision', () => {
    expect(deriveDefaultLoc('Sort imports', '', ['sort-imports'])).toBe('sort-imports-2');
  });

  it('appends -3 when -2 also taken', () => {
    expect(
      deriveDefaultLoc('Sort imports', '', ['sort-imports', 'sort-imports-2']),
    ).toBe('sort-imports-3');
  });

  it('does not collide across different parents', () => {
    // 'review:render-urn' exists, but we are creating under 'docs', so
    // 'docs:render-urn' is free.
    expect(
      deriveDefaultLoc('Render URN', 'docs', ['review:render-urn']),
    ).toBe('render-urn');
  });

  it('handles a parent-prefixed collision correctly', () => {
    expect(
      deriveDefaultLoc('Render URN', 'review', ['review:render-urn']),
    ).toBe('render-urn-2');
  });
});
