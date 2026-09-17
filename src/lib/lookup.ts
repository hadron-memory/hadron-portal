/**
 * Safe indexing for object-literal lookup tables (#835).
 *
 * A table written as an object literal inherits from `Object.prototype`. Index
 * it with a string this build does not control — a wire field, a URL param, a
 * request body, a form value — and it answers for keys it does not have:
 *
 *   TABLE['__proto__']    → Object.prototype  (truthy object)
 *   TABLE['valueOf']      → a function        (throws when called)
 *   TABLE['constructor']  → a function        (callable; returns {})
 *   TABLE['toString']     → a function        (callable; "[object Undefined]")
 *
 * Every guard these tables use is defeated by that. `hit ? hit() : fallback`
 * takes the hit; `TABLE[k] ?? fallback` never reaches the `??`; `if (!mapped)
 * return 400` lets the request through. The `constructor` and `toString` cases
 * are the ones worth the fix, because they do NOT throw — the caller renders a
 * plausible-looking wrong value and nothing reports a fault, on the one path
 * whose entire contract is *when in doubt, fall back*.
 *
 * `hrn:node:hadronmemory.com:hadron-portal:findings:a-lookup-table-answers-for-keys-it-does-not-have`
 * has the measurement and the history: the portal had produced this hole five
 * times as of #833, three of them inside one fortnight, each by someone who had
 * just fixed it elsewhere. That is why this is a named helper rather than an
 * inlined `Object.hasOwn` repeated at every site — one implementation, one test
 * suite covering the prototype keys exhaustively, and a single thing for a
 * reviewer to look for.
 *
 * Do NOT reach for this when the table is BUILT rather than written as a
 * literal. `new Map()` is immune by construction and is the better answer
 * there.
 */

/**
 * `table[key]`, but only when `table` genuinely owns `key`.
 *
 * Returns `undefined` for an absent key, a prototype key, and a nullish key
 * alike — so the caller's own `?? fallback` / `if (!hit)` works as written
 * instead of being silently pre-empted.
 *
 * Typed over the table rather than over its value, so a narrow-keyed
 * `Record<WidgetType, string>` works as well as an open `Record<string, T>`.
 * The former has no string index signature, so a `Record<string, T>` parameter
 * would reject exactly the tables whose keys are an enum — which are the ones
 * most likely to be indexed by a wire value in the first place.
 */
export function lookupOwn<T extends object>(
  table: T,
  key: string | null | undefined,
): T[keyof T] | undefined {
  if (key == null || !Object.hasOwn(table, key)) return undefined;
  return (table as Record<string, T[keyof T]>)[key];
}
