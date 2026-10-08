import { describe, expect, it } from 'vitest';
import { nodeStorageSchema } from './storage-schema';

describe('nodeStorageSchema', () => {
  it('carries ONLY the fields the storage form edits (#878)', () => {
    // Name, loc, description, content, abstract, tags, seq and edges moved to
    // the node page's own tabs. A field left in this schema but dropped from
    // the page would post empty and the action would CLEAR the stored value —
    // so the schema's key set is pinned, not merely its behaviour.
    expect(Object.keys(nodeStorageSchema.shape).sort()).toEqual([
      '_kind',
      'isRunnable',
      'objectType',
      'propertiesJson',
    ]);
  });

  it.each([
    ['true', true],
    ['false', false],
    [undefined, false],
  ])('reads the hidden isRunnable value %j as %j', (raw, expected) => {
    const result = nodeStorageSchema.safeParse(raw === undefined ? {} : { isRunnable: raw });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.isRunnable).toBe(expected);
  });

  // #588: structured storage fields.
  it('defaults objectType and propertiesJson to empty', () => {
    const result = nodeStorageSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.objectType).toBe('');
      expect(result.data.propertiesJson).toBe('');
    }
  });

  it('converts a propertiesJson parse failure into a field error', () => {
    const result = nodeStorageSchema.safeParse({ propertiesJson: '{ not json' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.propertiesJson?.[0]).toBe('Not valid JSON.');
    }
  });

  it('rejects a non-object propertiesJson payload', () => {
    const result = nodeStorageSchema.safeParse({ propertiesJson: '"scalar"' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.flatten().fieldErrors.propertiesJson?.[0]).toMatch(/JSON object/);
    }
  });
});
