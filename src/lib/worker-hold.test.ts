import { describe, expect, it } from 'vitest';
import { isHeld, workerHold } from './worker-hold';

describe('workerHold', () => {
  it('reports unselected when the field is absent from the projection', () => {
    // undefined is "this query did not ask", which must not render as "free".
    expect(workerHold({}, 'u1')).toEqual({ kind: 'unselected' });
    expect(workerHold({ heldAt: null }, 'u1')).toEqual({ kind: 'unselected' });
  });

  it('reports unselected for a missing worker rather than throwing', () => {
    expect(workerHold(null, 'u1')).toEqual({ kind: 'unselected' });
    expect(workerHold(undefined, 'u1')).toEqual({ kind: 'unselected' });
  });

  it('distinguishes unselected from null — the two must not collapse', () => {
    // The guard that matters: `undefined` (not asked) and `null` (asked, and
    // either free or masked) are different facts, and an `if (!id)` test would
    // merge them. Flip either branch to the other and this fails.
    expect(workerHold({}, 'u1').kind).toBe('unselected');
    expect(workerHold({ heldByUserId: null }, 'u1').kind).toBe('none');
  });

  it('reports self when the holder is the signed-in user', () => {
    expect(workerHold({ heldByUserId: 'u1', heldAt: '2026-08-20T12:00:00Z' }, 'u1')).toEqual({
      kind: 'self',
      since: '2026-08-20T12:00:00Z',
    });
  });

  it('reports other when the holder is somebody else', () => {
    expect(workerHold({ heldByUserId: 'u2', heldAt: '2026-08-20T12:00:00Z' }, 'u1')).toEqual({
      kind: 'other',
      since: '2026-08-20T12:00:00Z',
    });
  });

  it('degrades an unknown viewer to other, never to none', () => {
    // Without a viewer id we still know the name IS held — we just cannot say
    // it is yours. `none` would under-report a real hold, which is the more
    // damaging error of the two.
    for (const viewer of [null, undefined]) {
      const hold = workerHold({ heldByUserId: 'u2', heldAt: '2026-08-20T12:00:00Z' }, viewer);
      expect(hold.kind).toBe('other');
    }
  });

  it('does not treat a holder as self on a falsy-but-present viewer id', () => {
    // '' is falsy; a `viewerId && ...` guard would sail past this, and an
    // `==` comparison would match a null holder to a null viewer.
    expect(workerHold({ heldByUserId: 'u2', heldAt: null }, '').kind).toBe('other');
    expect(workerHold({ heldByUserId: null }, null).kind).toBe('none');
  });

  it('tolerates a holder with no heldAt without inventing a date', () => {
    // The schema says heldAt is null exactly when heldByUserId is, so this
    // shape should not occur — but the UI must degrade rather than render
    // "Invalid Date" if it ever does.
    expect(workerHold({ heldByUserId: 'u1' }, 'u1')).toEqual({ kind: 'self', since: null });
  });
});

describe('isHeld', () => {
  it('is true only when a hold is KNOWN to exist', () => {
    expect(isHeld({ kind: 'self', since: null })).toBe(true);
    expect(isHeld({ kind: 'other', since: null })).toBe(true);
  });

  it('is false for none — which means not-held OR masked, never a known hold', () => {
    // The masking caveat in one assertion: `none` must not be treated as
    // evidence either way, so it cannot count as held.
    expect(isHeld({ kind: 'none' })).toBe(false);
    expect(isHeld({ kind: 'unselected' })).toBe(false);
  });
});
