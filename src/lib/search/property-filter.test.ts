import { describe, expect, it } from 'vitest';
import { buildPropertyFilter, readPropertyFilter, propertyOperators } from './property-filter';
import type { MemorySchemaObjectType } from '$lib/schema/memory-schema';

const collection: MemorySchemaObjectType = { fields: {
  title: { type: 'text' }, count: { type: 'number' }, enabled: { type: 'boolean' },
  when: { type: 'datetime' }, status: { type: 'enum', values: ['', 'draft', 'live'] },
} };

describe('schema property filter → existing where grammar', () => {
  it.each([
    ['title', 'eq', '', { path: ['title'], as: 'text', eq: '' }],
    ['count', 'eq', '0', { path: ['count'], as: 'number', eq: 0 }],
    ['enabled', 'eq', 'false', { path: ['enabled'], as: 'boolean', eq: false }],
    ['status', 'eq', '0', { path: ['status'], as: 'text', eq: '' }],
    ['status', 'ne', '1', { path: ['status'], as: 'text', ne: 'draft' }],
    ['when', 'gte', '2026-10-24T00:00:00Z', { path: ['when'], as: 'datetime', gte: '2026-10-24T00:00:00Z' }],
    ['count', 'absent', '', { path: ['count'], as: 'number', exists: false }],
    ['title', 'exists', '', { path: ['title'], as: 'text', exists: true }],
  ])('%s %s %s retains typed wire value', (field, operator, input, expected) => {
    expect(buildPropertyFilter(collection, { field, operator, input }).value).toEqual(expected);
  });

  it.each([
    ['count', 'eq', ''], ['count', 'eq', '1e309'], ['count', 'eq', 'no'],
    ['enabled', 'eq', ''], ['enabled', 'eq', '0'], ['when', 'eq', 'not-a-date'],
    ['status', 'eq', '9'], ['title', 'lt', 'a'], ['no-field', 'eq', 'a'], ['constructor', 'eq', 'a'],
  ])('refuses invalid/unsupported %s %s %s rather than clearing', (field, operator, input) => {
    const out = buildPropertyFilter(collection, { field, operator, input });
    expect(out.error).toBeTruthy();
    expect(out.value).toBeNull();
  });

  it('offers only existing operators by declared type', () => {
    expect(propertyOperators('boolean')).toEqual(['eq', 'ne', 'exists', 'absent']);
    expect(propertyOperators('number')).toEqual(['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'exists', 'absent']);
  });

  it('reads only representable applied predicates, never rewrites complex/invalid JSON', () => {
    expect(readPropertyFilter(collection, '{"path":["enabled"],"as":"boolean","eq":false}'))
      .toEqual({ field: 'enabled', operator: 'eq', input: 'false' });
    expect(readPropertyFilter(collection, '{"path":["status"],"eq":""}'))
      .toEqual({ field: 'status', operator: 'eq', input: '0' });
    for (const text of ['{', '{"and":[{"path":["title"],"eq":"a"}]}', '{"path":["count"],"eq":"0"}', '{"field":"data","path":["title"],"eq":"a"}']) {
      expect(readPropertyFilter(collection, text)).toBeNull();
    }
  });
});


it.each([
  { path: ['title'], eq: 'a', ne: 'b' },
  { path: ['title'], eq: 'a', in: ['b'] },
  { path: ['title'], eq: 'a', contains: 'b' },
  { path: ['title'], eq: 'a', between: ['b', 'c'] },
  { path: ['title'], eq: 'a', surprise: true },
  { path: ['title'], as: 'number', eq: 'a' },
  { path: ['title'], eq: false },
  { path: ['title', 'nested'], eq: 'a' },
  { path: ['title'], exists: 'false' },
  { path: ['title'], exists: false, eq: 'a' },
  { path: ['status'], eq: 'undeclared' },
])('keeps nonrepresentable leaf in Advanced without dropping constraints: %j', predicate => {
  expect(readPropertyFilter(collection, JSON.stringify(predicate))).toBeNull();
});
