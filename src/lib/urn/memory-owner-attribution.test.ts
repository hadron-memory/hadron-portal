import { describe, expect, it } from 'vitest';
import { memoryOwnerOrgUrn } from './memory-owner-attribution';

describe('memoryOwnerOrgUrn', () => {
  it('derives the organization URN from a canonical memory URN root', () => {
    expect(memoryOwnerOrgUrn('hrn:mem:acme.com:docs')).toBe('hrn:org:acme.com');
  });

  it.each([
    ['wrong scheme', 'urn:mem:acme.com:docs'],
    ['wrong kind', 'hrn:node:acme.com:docs:tasks:one'],
    ['missing slug', 'hrn:mem:acme.com'],
    ['empty', ''],
    ['extra atom', 'hrn:mem:acme.com:docs:extra'],
    ['fragment', 'hrn:mem:acme.com:docs#fragment'],
    ['legacy', 'acme.com::docs'],
    ['null value', null],
    ['undefined value', undefined],
  ])('rejects %s instead of guessing an owner', (_name, value) => {
    expect(memoryOwnerOrgUrn(value)).toBeNull();
  });
});
