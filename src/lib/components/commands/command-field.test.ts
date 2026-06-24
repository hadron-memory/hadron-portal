import { describe, it, expect } from 'vitest';
import { normalizeUserRef, normalizeField, missingRequired, defaultValue, type CommandField } from './command-field';

describe('normalizeUserRef', () => {
  it('rewrites the @handle shorthand to a hrn:user URN', () => {
    expect(normalizeUserRef('@harneet')).toBe('hrn:user:harneet');
  });

  it('passes an already-qualified hrn:user URN through unchanged', () => {
    expect(normalizeUserRef('hrn:user:harneet')).toBe('hrn:user:harneet');
  });

  it('upgrades the legacy urn: scheme to hrn:', () => {
    expect(normalizeUserRef('urn:user:harneet')).toBe('hrn:user:harneet');
  });

  it('leaves a bare id untouched (just trimmed)', () => {
    expect(normalizeUserRef('  01HABCDEF  ')).toBe('01HABCDEF');
  });

  it('returns empty for blank input', () => {
    expect(normalizeUserRef('   ')).toBe('');
  });
});

describe('normalizeField', () => {
  const userField: CommandField = { name: 'user', label: 'User', kind: 'user' };
  const urnField: CommandField = { name: 'resource', label: 'Resource', kind: 'urn' };

  it('normalizes user fields via normalizeUserRef', () => {
    expect(normalizeField(userField, '@bob')).toBe('hrn:user:bob');
  });

  it('only trims non-user fields', () => {
    expect(normalizeField(urnField, '  hrn:memory:acme::docs  ')).toBe('hrn:memory:acme::docs');
  });
});

describe('missingRequired', () => {
  const fields: CommandField[] = [
    { name: 'user', label: 'User', kind: 'user', required: true },
    { name: 'resource', label: 'Resource', kind: 'urn', required: true },
    { name: 'note', label: 'Note', kind: 'text' }, // optional
  ];

  it('lists empty required fields', () => {
    expect(missingRequired(fields, { user: '@bob', resource: '', note: '' })).toEqual(['resource']);
  });

  it('treats whitespace-only as empty', () => {
    expect(missingRequired(fields, { user: '   ', resource: 'x' })).toEqual(['user']);
  });

  it('ignores optional fields and returns empty when all required are filled', () => {
    expect(missingRequired(fields, { user: '@bob', resource: 'x' })).toEqual([]);
  });

  it('treats an empty multiselect array and an unchecked checkbox as missing when required', () => {
    const f: CommandField[] = [
      { name: 'fields', label: 'Fields', kind: 'multiselect', required: true },
      { name: 'confirm', label: 'Confirm', kind: 'checkbox', required: true },
    ];
    expect(missingRequired(f, { fields: [], confirm: false })).toEqual(['fields', 'confirm']);
    expect(missingRequired(f, { fields: ['CONTENT'], confirm: true })).toEqual([]);
  });

  it('does not flag optional multiselect / checkbox when empty/unchecked', () => {
    const f: CommandField[] = [
      { name: 'include', label: 'Include', kind: 'multiselect' },
      { name: 'del', label: 'Delete', kind: 'checkbox' },
    ];
    expect(missingRequired(f, { include: [], del: false })).toEqual([]);
  });
});

describe('defaultValue', () => {
  it('seeds checkbox=false, multiselect=[], everything else=""', () => {
    expect(defaultValue({ name: 'a', label: 'A', kind: 'checkbox' })).toBe(false);
    expect(defaultValue({ name: 'b', label: 'B', kind: 'multiselect' })).toEqual([]);
    expect(defaultValue({ name: 'c', label: 'C', kind: 'urn' })).toBe('');
    expect(defaultValue({ name: 'd', label: 'D', kind: 'text' })).toBe('');
  });
});
