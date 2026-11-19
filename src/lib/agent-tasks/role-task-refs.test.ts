import { describe, expect, it } from 'vitest';
import { roleTaskLabel } from './role-task-refs';

const ref = { nodeId: 'n1', urn: 'hrn:node:acme.com:team:tasks:build-ui', revision: 3 };

describe('roleTaskLabel', () => {
  it('uses the live name when there is one', () => expect(roleTaskLabel(ref, { n1: 'Build UI' })).toBe('Build UI'));
  it('falls back to the URN leaf without a name', () => {
    expect(roleTaskLabel(ref, undefined)).toBe('build-ui');
    expect(roleTaskLabel(ref, {})).toBe('build-ui');
    expect(roleTaskLabel(ref, { n1: '   ' })).toBe('build-ui');
  });
  it('never resolves a name through the prototype', () => {
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(roleTaskLabel({ ...ref, nodeId: id }, {}), id).toBe('build-ui');
    }
  });
  it('shows the whole URN when it has no segment to take', () => {
    expect(roleTaskLabel({ ...ref, urn: 'opaque' }, {})).toBe('opaque');
    expect(roleTaskLabel({ ...ref, urn: 'hrn:node:x:' }, {})).toBe('hrn:node:x:');
  });
});
