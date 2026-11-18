import type { MemorySchemaFieldType, MemorySchemaObjectType } from '$lib/schema/memory-schema';

export interface PropertyFilterDraft { field: string; operator: string; input: string }
export type PropertyPredicate = { path: string[]; as: string } & Record<string, unknown>;
const common = ['eq', 'ne', 'exists', 'absent'];
const ordered = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'exists', 'absent'];
export function propertyOperators(type: MemorySchemaFieldType): string[] {
  return type === 'number' || type === 'datetime' ? ordered : common;
}

/** UI subset only. The server remains the grammar/type authority. */
export function buildPropertyFilter(collection: MemorySchemaObjectType | null, draft: PropertyFilterDraft): {
  value: PropertyPredicate | null; error: 'field' | 'operator' | 'value' | null;
} {
  if (!collection || !Object.hasOwn(collection.fields, draft.field)) return { value: null, error: 'field' };
  const field = collection.fields[draft.field];
  if (!propertyOperators(field.type).includes(draft.operator)) return { value: null, error: 'operator' };
  const base = { path: [draft.field], as: field.type === 'enum' ? 'text' : field.type };
  if (draft.operator === 'exists' || draft.operator === 'absent') {
    return { value: { ...base, exists: draft.operator === 'exists' }, error: null };
  }
  let value: string | number | boolean = draft.input;
  if (field.type === 'number') {
    if (!draft.input.trim() || !Number.isFinite(Number(draft.input))) return { value: null, error: 'value' };
    value = Number(draft.input);
  } else if (field.type === 'boolean') {
    if (draft.input !== 'true' && draft.input !== 'false') return { value: null, error: 'value' };
    value = draft.input === 'true';
  } else if (field.type === 'datetime') {
    if (!draft.input.trim() || Number.isNaN(Date.parse(draft.input))) return { value: null, error: 'value' };
  } else if (field.type === 'enum') {
    // Index, rather than value, leaves an empty declared string selectable.
    if (!/^\d+$/.test(draft.input) || !field.values || Number(draft.input) >= field.values.length) return { value: null, error: 'value' };
    value = field.values[Number(draft.input)];
  }
  return { value: { ...base, [draft.operator]: value }, error: null };
}

/** Never reinterpret complex, malformed or differently typed raw predicates. */
export function readPropertyFilter(collection: MemorySchemaObjectType | null, text: string): PropertyFilterDraft | null {
  if (!collection) return null;
  if (!text.trim()) return { field: '', operator: 'eq', input: '' };
  try {
    const p = JSON.parse(text);
    if (!p || typeof p !== 'object' || Array.isArray(p) || !Array.isArray(p.path) || p.path.length !== 1) return null;
    const name = p.path[0];
    if (typeof name !== 'string' || !Object.hasOwn(collection.fields, name) || (p.field !== undefined && p.field !== 'properties')) return null;
    const field = collection.fields[name];
    const cast = field.type === 'enum' ? 'text' : field.type;
    if ((p.as ?? 'text') !== cast) return null;
    const ops = ['eq', 'ne', 'lt', 'lte', 'gt', 'gte', 'exists'].filter(k => Object.hasOwn(p, k));
    if (ops.length !== 1 || Object.keys(p).some(k => !['field', 'path', 'as', ...ops].includes(k))) return null;
    const op = ops[0];
    if (op === 'exists') {
      return typeof p.exists === 'boolean' ? { field: name, operator: p.exists ? 'exists' : 'absent', input: '' } : null;
    }
    const value = p[op];
    const expected = field.type === 'number' ? 'number' : field.type === 'boolean' ? 'boolean' : 'string';
    if (typeof value !== expected) return null;
    let input = String(value);
    if (field.type === 'enum') {
      const i = field.values?.indexOf(value) ?? -1;
      if (i < 0) return null;
      input = String(i);
    }
    const draft = { field: name, operator: op, input };
    return buildPropertyFilter(collection, draft).error ? null : draft;
  } catch { return null; }
}
