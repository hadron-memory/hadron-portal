/**
 * #1320 — no two forms a page's loader returns may share a Superforms id.
 *
 * Superforms keys a form's client store by its id, and the default id is a hash
 * of the schema's SHAPE, so two schemas with the same fields share one store
 * whatever their `_kind`. One form then submits with the other's values (#1297)
 * or receives its result (#995). The fix is an explicit `id` in the loader, the
 * action and `superForm`.
 *
 * Pass the loader's return value. A form is any property whose value carries a
 * string `id` next to `data` and `valid`; nested objects are searched too, so a
 * page that groups its forms is covered.
 */
import { expect } from 'vitest';

type FormLike = { id: string; data: unknown; valid: boolean };

const isForm = (v: unknown): v is FormLike =>
  !!v && typeof v === 'object' && typeof (v as FormLike).id === 'string' && 'data' in v && 'valid' in v;

export function formIdsOf(data: unknown, path = ''): Array<{ key: string; id: string }> {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data as Record<string, unknown>).flatMap(([k, v]) => {
    const key = path ? `${path}.${k}` : k;
    return isForm(v) ? [{ key, id: v.id }] : formIdsOf(v, key);
  });
}

export function expectDistinctFormIds(data: unknown, expectedAtLeast = 2): void {
  const forms = formIdsOf(data);
  // A page that stopped returning its forms would pass vacuously.
  expect(forms.length, 'forms found in the loader result').toBeGreaterThanOrEqual(expectedAtLeast);
  const byId = new Map<string, string[]>();
  for (const { key, id } of forms) byId.set(id, [...(byId.get(id) ?? []), key]);
  const shared = [...byId].filter(([, keys]) => keys.length > 1).map(([id, keys]) => `${id}: ${keys.join(', ')}`);
  expect(shared, 'forms sharing a Superforms id').toEqual([]);
}
