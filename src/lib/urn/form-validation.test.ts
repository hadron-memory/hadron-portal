import { describe, expect, it } from 'vitest';
import {
  toBareMemorySlugInput,
  validateHandleField,
  validateMemorySlugField,
  validateOrgSlugField,
} from './form-validation';

describe('URN form validation helpers', () => {
  it('accepts blank handles but validates provided handles', () => {
    expect(validateHandleField('')).toBeNull();
    expect(validateHandleField('alice.dev')).toBeNull();
    expect(validateHandleField('Alice')).toMatch(/lowercase|reserved/);
  });

  it('accepts reserved words as memory slugs but validates atom shape', () => {
    expect(validateMemorySlugField('system')).toBeNull();
    expect(validateMemorySlugField('Bad Slug')).toMatch(/lowercase|letters/);
  });

  it('rejects full organization URNs', () => {
    expect(validateOrgSlugField('hrn:org:acme')).toMatch(/bare slug/);
  });

  describe('toBareMemorySlugInput', () => {
    it('returns a bare slug unchanged', () => {
      expect(toBareMemorySlugInput('mmdata')).toBe('mmdata');
    });

    it('trims and returns empty for blank input', () => {
      expect(toBareMemorySlugInput('   ')).toBe('');
    });

    it('strips a v1 hierarchy memory URN to its slug segment', () => {
      expect(toBareMemorySlugInput('hrn:memory:acme.com::mmdata')).toBe('mmdata');
      expect(toBareMemorySlugInput('urn:memory:acme.com::mmdata')).toBe('mmdata');
    });

    it('strips a grammar-v2 flat memory URN to its terminal slug (#697)', () => {
      // `mem` type word + single colon — the old regex missed both.
      expect(toBareMemorySlugInput('hrn:mem:acme.com:mmdata')).toBe('mmdata');
      expect(toBareMemorySlugInput('urn:mem:acme.com:mmdata')).toBe('mmdata');
    });

    it('strips a v2 flat memory URN with an undotted user-handle root', () => {
      expect(toBareMemorySlugInput('hrn:mem:holger:notes')).toBe('notes');
    });
  });
});
