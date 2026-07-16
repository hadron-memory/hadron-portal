import { describe, expect, it } from 'vitest';
import { validateHandleField, validateMemorySlugField, validateOrgSlugField } from './form-validation';

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
});
