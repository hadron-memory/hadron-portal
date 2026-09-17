/**
 * #835 — the prototype keys, exhaustively, in one place.
 *
 * Every call site that used to index a literal directly now goes through
 * `lookupOwn`, so this is the suite that actually pins the class. The per-site
 * tests assert the FALLBACK VALUE each site promises, which is the assertion
 * that distinguishes a fixed site from a broken one — `not.toBe(mappedCopy)`
 * passes on the garbage too.
 */
import { describe, expect, it } from 'vitest';
import { lookupOwn } from './lookup';

const TABLE = { known: 'mapped', falsy: '' } as Record<string, string>;

/**
 * The keys `Object.prototype` supplies — DERIVED, not hand-listed (@copilot on
 * #846, and the correction was fair twice over).
 *
 * The hand-written list omitted `__defineGetter__`, `__defineSetter__`,
 * `__lookupGetter__` and `__lookupSetter__` while the docblock above it claimed
 * to be exhaustive. Replacing the claim with the enumeration is strictly better
 * than completing the list by hand: a hand-list is exhaustive on the day it is
 * written and silently stops being so, which is the same failure this whole
 * module exists to prevent — a table that answers for a key nobody enumerated.
 *
 * `hasOwnProperty` is worth naming even so: it is the key a prober is most
 * likely to type, and the one whose NAME makes the guard look already applied.
 *
 * `constructor` and `toString` are the pair that matter — they return something
 * plausible rather than throwing — but every one of these defeats a truthiness
 * guard, so every one is pinned.
 */
const PROTOTYPE_KEYS = Object.getOwnPropertyNames(Object.prototype);

describe('lookupOwn', () => {
  it('returns the value for a key the table owns', () => {
    expect(lookupOwn(TABLE, 'known')).toBe('mapped');
  });

  it('returns an owned FALSY value rather than collapsing it to undefined', () => {
    // The guard is about ownership, not truthiness. A table whose value is ''
    // or 0 must still report a hit, or the helper introduces the very
    // fallback-skipping bug it exists to prevent, in the other direction.
    expect(lookupOwn(TABLE, 'falsy')).toBe('');
  });

  it('returns undefined for an ordinary missing key', () => {
    expect(lookupOwn(TABLE, 'nope')).toBeUndefined();
  });

  it.each([null, undefined])('returns undefined for a %s key', (key) => {
    expect(lookupOwn(TABLE, key)).toBeUndefined();
  });

  it('enumerates every inherited key, so this suite cannot silently narrow', () => {
    // The guard on the guard: if a future runtime adds an own property to
    // Object.prototype, the cases below cover it automatically — but only if
    // the list is genuinely the enumeration and not a snapshot someone pasted.
    expect(PROTOTYPE_KEYS).toContain('constructor');
    expect(PROTOTYPE_KEYS).toContain('__proto__');
    expect(PROTOTYPE_KEYS).toContain('__defineGetter__');
    expect(PROTOTYPE_KEYS.length).toBeGreaterThanOrEqual(12);
  });

  it.each(PROTOTYPE_KEYS)('returns undefined for the inherited key %s', (key) => {
    expect(lookupOwn(TABLE, key)).toBeUndefined();
  });

  it.each(PROTOTYPE_KEYS)('…where a bare index would NOT have (%s)', (key) => {
    // The other direction, and the reason this suite is worth having: without
    // it, every assertion above would also pass against a helper that simply
    // returned undefined for everything. This proves the hazard is real for
    // each key rather than assuming the list is right.
    expect((TABLE as Record<string, unknown>)[key]).toBeDefined();
  });

  it('a table with a null prototype needs no helper — documenting the alternative', () => {
    const bare = Object.assign(Object.create(null), { known: 'mapped' }) as Record<string, string>;
    expect(bare['constructor']).toBeUndefined();
    expect(lookupOwn(bare, 'constructor')).toBeUndefined();
  });
});
