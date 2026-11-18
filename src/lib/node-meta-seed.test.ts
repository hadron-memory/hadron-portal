/** #921 / @codex on #929 — the metadata form's single seed list. */
import { describe, expect, it } from 'vitest';
import { metaSavedDespiteFailure, nodeMetaReseed, nodeMetaSeed, nodeMetaSeedKey, savedButNotMoved, withoutTrailingPunctuation } from './node-meta-seed';
import { nodeUpdateMetaSchema } from '../routes/app/memories/[id]/nodes/[nodeId]/schema';

const node = {
  id: 'n1', name: 'X', nodeType: 'info', description: 'd', alias: 'a', seq: 3,
  tags: ['t1', 't2'], isRunnable: true, loc: 'specs:x', role: 'spec.feature',
};

describe('nodeMetaSeed', () => {
  it('seeds every field the metadata form submits, role and its seed included', () => {
    const seed = nodeMetaSeed(node);
    // Every schema field but the discriminator is seeded: a field added to the
    // form without a seed fails here instead of showing the previous node's value.
    const formFields = Object.keys(nodeUpdateMetaSchema.shape).filter((k) => k !== '_kind').sort();
    expect(Object.keys(seed).sort()).toEqual(formFields);
    expect(seed).toMatchObject({ role: 'spec.feature', roleSeed: 'spec.feature', tags: 't1, t2', isRunnable: true });
  });

  it('seeds an unset role as empty in both the input and the seed', () => {
    expect(nodeMetaSeed({ ...node, role: null })).toMatchObject({ role: '', roleSeed: '' });
  });
});

describe('nodeMetaSeedKey — when the page reseeds', () => {
  it('changes with the node AND with its stored role, and only then', () => {
    const k = nodeMetaSeedKey(node);
    expect(nodeMetaSeedKey({ ...node })).toBe(k);
    expect(nodeMetaSeedKey({ ...node, id: 'n2' })).not.toBe(k);
    // After a role save: same node, new role, so the seed is refreshed.
    expect(nodeMetaSeedKey({ ...node, role: 'spec.rule' })).not.toBe(k);
    expect(nodeMetaSeedKey({ ...node, role: null })).not.toBe(k);
  });

  it('cannot confuse an id/role pair with another by concatenation', () => {
    expect(nodeMetaSeedKey({ id: 'a', role: 'bc' })).not.toBe(nodeMetaSeedKey({ id: 'ab', role: 'c' }));
  });
});

describe('metaSavedDespiteFailure (@codex on #929)', () => {
  it('is true only for a failure that says its edits were saved', () => {
    expect(metaSavedDespiteFailure({ type: 'failure', data: { metaSaved: true } })).toBe(true);
    expect(metaSavedDespiteFailure({ type: 'failure', data: { form: {} } })).toBe(false);
    expect(metaSavedDespiteFailure({ type: 'failure', data: { metaSaved: 'yes' } })).toBe(false);
    expect(metaSavedDespiteFailure({ type: 'success', data: { metaSaved: true } })).toBe(false);
    expect(metaSavedDespiteFailure({ type: 'failure' })).toBe(false);
  });
});

describe('nodeMetaReseed — what a node change writes into the form (@codex on #929)', () => {
  it('reseeds EVERYTHING for a different node', () => {
    expect(nodeMetaReseed({ id: 'n0', role: 'review' }, node)).toEqual(nodeMetaSeed(node));
  });

  it('patches ONLY role and roleSeed when the same node\'s stored role changed, so a typed location survives', () => {
    const patch = nodeMetaReseed({ id: 'n1', role: 'spec' }, node)!;
    expect(patch).toEqual({ role: 'spec.feature', roleSeed: 'spec.feature' });
    expect(patch).not.toHaveProperty('loc');
    expect(nodeMetaReseed({ id: 'n1', role: 'spec.feature' }, { ...node, role: null })).toEqual({ role: '', roleSeed: '' });
  });

  it('writes nothing when neither the node nor its role changed', () => {
    expect(nodeMetaReseed({ id: 'n1', role: 'spec.feature' }, node)).toBeNull();
    expect(nodeMetaReseed({ id: 'n1', role: null }, { ...node, role: '' })).toBeNull();
  });
});

describe('savedButNotMoved (#1989)', () => {
  const failure = (form: unknown, metaSaved = true) => ({ type: 'failure', data: { form, metaSaved } });

  it('keeps a 409 collision from its loc field error, with the loc the user typed', () => {
    expect(savedButNotMoved(failure({ errors: { loc: ['Saved, but not moved.'] }, data: { loc: 'taken' } })))
      .toEqual({ text: 'Saved, but not moved.', loc: 'taken' });
  });

  it('keeps any other refused move from the form message', () => {
    expect(savedButNotMoved(failure({ message: { type: 'error', text: 'Saved, but refused.' }, errors: {}, data: { loc: 'x' } })))
      .toEqual({ text: 'Saved, but refused.', loc: 'x' });
  });

  it('keeps a loc field error that is a plain string, not only the array form (portal#2005 F6)', () => {
    expect(savedButNotMoved(failure({ errors: { loc: 'Saved, but not moved.' }, data: { loc: 'taken' } })))
      .toEqual({ text: 'Saved, but not moved.', loc: 'taken' });
  });

  it('is null when there is text but the typed loc is not a string, or is empty (portal#2005 F6)', () => {
    expect(savedButNotMoved(failure({ message: { type: 'error', text: 'Refused.' }, errors: {}, data: { loc: 7 } }))).toBe(null);
    expect(savedButNotMoved(failure({ message: { type: 'error', text: 'Refused.' }, errors: {}, data: {} }))).toBe(null);
    expect(savedButNotMoved(failure({ message: { type: 'error', text: 'Refused.' }, errors: {}, data: { loc: '' } }))).toBe(null);
  });

  it('is null when nothing was saved, when the action succeeded, or when there is no text', () => {
    expect(savedButNotMoved(failure({ errors: { loc: ['no'] }, data: { loc: 'x' } }, false))).toBe(null);
    expect(savedButNotMoved({ type: 'success', data: { form: {} } })).toBe(null);
    expect(savedButNotMoved(failure({ errors: {}, data: { loc: 'x' } }))).toBe(null);
  });
});

describe('withoutTrailingPunctuation (portal#2005 F4)', () => {
  it.each([
    ['Target is taken.', 'Target is taken'],
    ['Target is taken!', 'Target is taken'],
    ['Target is taken?!  ', 'Target is taken'],
    ['Target is taken:', 'Target is taken'],
    ['Target is taken; ', 'Target is taken'],
    ['Target is taken', 'Target is taken'],
    ['', ''],
  ])('%j becomes %j', (input, expected) => {
    expect(withoutTrailingPunctuation(input)).toBe(expected);
  });

  it('keeps punctuation inside the text', () => {
    expect(withoutTrailingPunctuation('Loc "a:b" is taken.')).toBe('Loc "a:b" is taken');
  });
});
