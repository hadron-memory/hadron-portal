import { describe, expect, it } from 'vitest';
import { validateHandleField, validateMemorySlugField, validateOrgSlugField } from './form-validation';

describe('URN form validation helpers', () => {
  it('accepts blank handles but validates provided handles', () => {
    expect(validateHandleField('')).toBeNull();
    expect(validateHandleField('alice.dev')).toBeNull();
    expect(validateHandleField('Alice')).toMatch(/lowercase|reserved/);
  });

  it('rejects reserved memory slugs', () => {
    expect(validateMemorySlugField('system')).toMatch(/reserved/);
  });

  it('rejects full organization URNs', () => {
    expect(validateOrgSlugField('hrn:org:acme')).toMatch(/bare slug/);
  });
});
