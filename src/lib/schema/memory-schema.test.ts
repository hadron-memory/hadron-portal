import { describe, expect, it } from 'vitest';
import {
  MemorySchemaError,
  declaredObjectType,
  objectTypeNames,
  parseMemorySchema,
  readMemorySchema,
} from './memory-schema';

const VALID = {
  objectTypes: {
    competitor: {
      description: 'A competitor we track',
      strict: true,
      fields: {
        name: { type: 'text', required: true },
        stage: { type: 'enum', values: ['seed', 'series-a'] },
        fundingUsd: { type: 'number' },
        firstSeen: { type: 'datetime', description: 'When we first noticed them' },
        active: { type: 'boolean' },
      },
    },
  },
};

describe('parseMemorySchema', () => {
  it('accepts and normalizes a valid schema', () => {
    const schema = parseMemorySchema(VALID);
    expect(Object.keys(schema.objectTypes)).toEqual(['competitor']);
    const competitor = schema.objectTypes.competitor;
    expect(competitor.strict).toBe(true);
    expect(competitor.fields.name).toEqual({ type: 'text', required: true });
    expect(competitor.fields.stage.values).toEqual(['seed', 'series-a']);
  });

  it.each([
    ['non-object input', 'not-an-object'],
    ['array input', []],
    ['null input', null],
    ['missing objectTypes', {}],
    ['empty objectTypes', { objectTypes: {} }],
    ['unknown top-level key', { objectTypes: VALID.objectTypes, extra: 1 }],
  ])('rejects %s', (_label, input) => {
    expect(() => parseMemorySchema(input)).toThrow(MemorySchemaError);
  });

  it('rejects a field typo (unknown key) at author time', () => {
    expect(() =>
      parseMemorySchema({
        objectTypes: { c: { fields: { name: { type: 'text', requird: true } } } },
      }),
    ).toThrow(/unknown key "requird"/);
  });

  it('rejects an unknown field type', () => {
    expect(() =>
      parseMemorySchema({
        objectTypes: { c: { fields: { name: { type: 'string' } } } },
      }),
    ).toThrow(/must be one of/);
  });

  it('requires non-empty values for enum and forbids values otherwise', () => {
    expect(() =>
      parseMemorySchema({ objectTypes: { c: { fields: { s: { type: 'enum' } } } } }),
    ).toThrow(/requires a non-empty "values" array/);
    expect(() =>
      parseMemorySchema({ objectTypes: { c: { fields: { s: { type: 'text', values: ['a'] } } } } }),
    ).toThrow(/only valid for type "enum"/);
  });

  it('rejects non-identifier collection and field names', () => {
    expect(() =>
      parseMemorySchema({ objectTypes: { 'bad name': { fields: { a: { type: 'text' } } } } }),
    ).toThrow(/invalid object type name/);
    expect(() =>
      parseMemorySchema({ objectTypes: { c: { fields: { 'bad key!': { type: 'text' } } } } }),
    ).toThrow(/invalid field name/);
  });
});

describe('readMemorySchema', () => {
  it('returns null for null/undefined', () => {
    expect(readMemorySchema(null)).toBeNull();
    expect(readMemorySchema(undefined)).toBeNull();
  });

  it('degrades a malformed stored schema to null instead of throwing', () => {
    expect(readMemorySchema({ objectTypes: 'garbage' })).toBeNull();
  });

  it('parses a valid stored schema', () => {
    expect(readMemorySchema(VALID)).not.toBeNull();
  });
});

describe('pickers', () => {
  it('objectTypeNames lists declared collections (empty for null)', () => {
    expect(objectTypeNames(readMemorySchema(VALID))).toEqual(['competitor']);
    expect(objectTypeNames(null)).toEqual([]);
  });

  it('declaredObjectType resolves declared names and null-safes the rest', () => {
    const schema = readMemorySchema(VALID);
    expect(declaredObjectType(schema, 'competitor')?.fields.name.type).toBe('text');
    expect(declaredObjectType(schema, 'unknown')).toBeNull();
    expect(declaredObjectType(schema, null)).toBeNull();
    expect(declaredObjectType(null, 'competitor')).toBeNull();
  });
});
