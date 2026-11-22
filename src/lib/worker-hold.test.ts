import { describe, expect, it } from 'vitest';
import { holderForHold, holderLabel, isHeld, workerHold } from './worker-hold';

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
      holderId: 'u1',
    });
  });

  it('reports other when the holder is somebody else', () => {
    expect(workerHold({ heldByUserId: 'u2', heldAt: '2026-08-20T12:00:00Z' }, 'u1')).toEqual({
      kind: 'other',
      since: '2026-08-20T12:00:00Z',
      holderId: 'u2',
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
    expect(workerHold({ heldByUserId: 'u1' }, 'u1')).toEqual({ kind: 'self', since: null, holderId: 'u1' });
  });
});

describe('isHeld', () => {
  it('is true only when a hold is KNOWN to exist', () => {
    expect(isHeld({ kind: 'self', since: null, holderId: 'u1' })).toBe(true);
    expect(isHeld({ kind: 'other', since: null, holderId: 'u2' })).toBe(true);
  });

  it('is false for none — which means not-held OR masked, never a known hold', () => {
    // The masking caveat in one assertion: `none` must not be treated as
    // evidence either way, so it cannot count as held.
    expect(isHeld({ kind: 'none' })).toBe(false);
    expect(isHeld({ kind: 'unselected' })).toBe(false);
  });
});

// #825 — the release control asserts WHICH hold it is acting on, and it takes
// that id from here rather than re-reading the raw field, so that narrowing
// `kind` narrows the id with it. These pin the id on both HELD states and its
// ABSENCE on the two that have no holder to name.
describe('workerHold — holderId (#825)', () => {
  it('carries the holder id on a self hold', () => {
    expect(workerHold({ heldByUserId: 'u1', heldAt: '2026-09-09T00:00:00Z' }, 'u1')).toMatchObject({
      kind: 'self',
      holderId: 'u1',
    });
  });

  it('carries the holder id on someone else’s hold, even though the holder is unnamed', () => {
    // portal#748: the UI cannot NAME the holder without an N+1 per row. The id
    // is a different thing from the name, and it is what the write asserts.
    expect(workerHold({ heldByUserId: 'u2', heldAt: '2026-09-09T00:00:00Z' }, 'u1')).toMatchObject({
      kind: 'other',
      holderId: 'u2',
    });
  });

  it('carries the id when the viewer is unknown, where the hold degrades to other', () => {
    expect(workerHold({ heldByUserId: 'u2' }, null)).toMatchObject({ kind: 'other', holderId: 'u2' });
  });

  it('has no holderId on none or unselected — there is no holder to assert', () => {
    // An empty string here would be a value that READS as one: it would satisfy
    // a `min(1)`-less schema and assert a holder nobody has.
    expect(workerHold({ heldByUserId: null }, 'u1')).not.toHaveProperty('holderId');
    expect(workerHold({}, 'u1')).not.toHaveProperty('holderId');
  });
});

describe('holderForHold (#1330)', () => {
  const holder = { id: 'u9', name: 'Sample Holder', handle: 'sample-holder', urn: 'hrn:user:acme.com:sample-holder' };
  it('returns the holder only when its id is the hold\'s', () => {
    expect(holderForHold(workerHold({ heldByUserId: 'u9' }, 'u1'), holder)).toBe(holder);
    expect(holderForHold(workerHold({ heldByUserId: 'u1' }, 'u1'), { ...holder, id: 'u1' })).toMatchObject({ id: 'u1' });
  });
  it.each([['other', 'u9', 'u8'], ['self', 'u1', 'u9']])('drops a %s-hold holder from another read', (_k, held, other) => {
    expect(holderForHold(workerHold({ heldByUserId: held }, 'u1'), { ...holder, id: other })).toBeNull();
  });
  it.each([null, undefined])('is null for a masked or absent holder (%s)', h => {
    expect(holderForHold(workerHold({ heldByUserId: 'u9' }, 'u1'), h)).toBeNull();
  });
  it.each([{ heldByUserId: null }, {}])('is null when no hold is known (%j)', w => {
    expect(holderForHold(workerHold(w, 'u1'), holder)).toBeNull();
  });
});

describe('holderLabel (#1330)', () => {
  it('prefers the name, then the handle, treating blank as unset', () => {
    expect(holderLabel({ name: 'Ada', handle: 'ada' })).toBe('Ada');
    expect(holderLabel({ name: '', handle: 'ada' })).toBe('ada');
    expect(holderLabel({ name: '  ', handle: 'ada' })).toBe('ada');
    expect(holderLabel({ name: null, handle: null })).toBeNull();
    expect(holderLabel(null)).toBeNull();
  });
});
