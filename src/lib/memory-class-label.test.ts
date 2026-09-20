/**
 * #1176 — the "Kind" badge on /app/memories must name the class it is given.
 *
 * Driven at the time: @Holger's `holger:flow-lab` and `holger:holgers-gear` are
 * `knowledge`, became visible with the `ownedByMe` swap, and read "Personal"
 * until this changed — the badge asserting something false about the very rows
 * the fix had just surfaced.
 */
import { describe, expect, it } from 'vitest';
import { memoryClassLabel } from './memory-class-label';

describe('memoryClassLabel', () => {
  it('names a knowledge memory "Knowledge", not "Personal"', () => {
    // The regression this file exists for. The old binary returned "Personal"
    // for everything that was not `private`.
    expect(memoryClassLabel('knowledge')).toBe('Knowledge');
  });

  it.each([
    ['personal', 'Personal'],
    ['private', 'Private'],
    ['knowledge', 'Knowledge'],
    ['group', 'Group'],
    ['app', 'App'],
    ['system', 'System'],
  ])('labels %s as %s', (cls, label) => {
    expect(memoryClassLabel(cls)).toBe(label);
  });

  it('covers every class the schema defines', () => {
    // A new MemoryClass must be a deliberate edit here rather than silently
    // falling into a friendly-sounding default — which is what went wrong.
    const schemaClasses = ['app', 'group', 'knowledge', 'personal', 'private', 'system'];
    for (const cls of schemaClasses) expect(memoryClassLabel(cls)).not.toBe(cls);
  });

  it('renders an UNKNOWN class verbatim rather than guessing', () => {
    // Honest and obviously wrong to a reader, which a friendly label is not.
    expect(memoryClassLabel('newclass')).toBe('newclass');
    expect(memoryClassLabel('')).toBe('');
  });
});
