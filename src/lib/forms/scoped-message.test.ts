import { describe, expect, it } from 'vitest';
import { scopedActionError, scopedActionSuccess } from './scoped-message';

type ExampleForm = {
  _kind: 'example';
  id: string;
};

function actionData(kind = 'example') {
  return { form: { data: { _kind: kind } } };
}

describe('scoped Superforms action messages', () => {
  it('returns an error message only for the submitted kind', () => {
    const message = { type: 'error' as const, text: 'Failed.' };

    expect(scopedActionError<ExampleForm>(actionData(), 'example', message)).toBe('Failed.');
    expect(scopedActionError<ExampleForm>(actionData('other'), 'example', message)).toBeNull();
    expect(scopedActionError<ExampleForm>(null, 'example', message)).toBeNull();
    expect(scopedActionError<ExampleForm>(undefined, 'example', message)).toBeNull();
  });

  it('falls back to field errors for the submitted kind', () => {
    expect(scopedActionError<ExampleForm>(
      actionData(),
      'example',
      null,
      { id: ['Missing id.'], _kind: ['Wrong action.'] },
      ['id', '_kind'],
    )).toBe('Missing id.');
    expect(scopedActionError<ExampleForm>(
      actionData(),
      'example',
      null,
      { _kind: ['Wrong action.'] },
    )).toBe('Wrong action.');
  });

  it('returns null when no error source applies', () => {
    expect(scopedActionError<ExampleForm>(actionData(), 'example', null, {})).toBeNull();
    expect(scopedActionError<ExampleForm>(
      actionData(),
      'example',
      null,
      { id: ['Missing id.'] },
      [],
    )).toBeNull();
  });

  it('returns a success message only for the submitted kind', () => {
    const message = { type: 'success' as const, text: 'Saved.' };

    expect(scopedActionSuccess<ExampleForm>(actionData(), 'example', message)).toBe('Saved.');
    expect(scopedActionSuccess<ExampleForm>(actionData('other'), 'example', message)).toBeNull();
    expect(scopedActionSuccess<ExampleForm>(null, 'example', message)).toBeNull();
    expect(scopedActionSuccess<ExampleForm>(undefined, 'example', message)).toBeNull();
    expect(scopedActionSuccess<ExampleForm>(actionData(), 'example', { type: 'error', text: 'Nope.' })).toBeNull();
  });

  it('prefers error messages but can fall through from success messages to field errors', () => {
    expect(scopedActionError<ExampleForm>(actionData(), 'example', { type: 'error', text: 'Failed.' }, null)).toBe('Failed.');
    expect(scopedActionError<ExampleForm>(
      actionData(),
      'example',
      { type: 'success', text: 'Saved.' },
      { id: ['Still invalid.'] },
      ['id'],
    )).toBe('Still invalid.');
  });

  /**
   * #780 — the fallback list is what decides whether a field error ALSO reaches
   * the form-level alert, so a form that renders the field inline must leave it
   * out or the same sentence prints twice.
   *
   * The move dialog is the one form on the node page that renders a per-field
   * error (`$moveErrors.target`, under the input). Its server action already
   * picks a surface — `setError` on `target` for the user-fixable codes
   * (NODE_ALREADY_EXISTS / CONFLICT / BAD_USER_INPUT), a form-level `message`
   * for a genuine fault — so the two are mutually exclusive at the source.
   * Listing `target` as a fallback re-merged them on the client.
   *
   * Pinned here rather than as a component test because a `$derived` in a
   * `.svelte` file is unreachable from this repo's SSR-only harness (#795):
   * `render` from `svelte/server` never runs it. This is the same predicate the
   * component computes, with the same arguments.
   */
  describe('a field rendered inline must not also feed the alert (#780)', () => {
    type MoveForm = { _kind: 'moveNode'; target: string };
    const moved = { form: { data: { _kind: 'moveNode' } } };
    const occupied = { target: ['A live node already occupies loc "x".'] };

    it('leaves the alert empty when the server set a field error', () => {
      expect(scopedActionError<MoveForm>(moved, 'moveNode', null, occupied, ['_kind'])).toBeNull();
    });

    it('and would duplicate it if target were listed — the pre-fix behaviour', () => {
      // The exact regression: both surfaces render the identical sentence.
      expect(scopedActionError<MoveForm>(moved, 'moveNode', null, occupied, ['_kind', 'target']))
        .toBe(occupied.target[0]);
    });

    it('still shows a genuine fault, which has no field error to render', () => {
      expect(scopedActionError<MoveForm>(
        moved,
        'moveNode',
        { type: 'error', text: 'Failed to move node' },
        {},
        ['_kind'],
      )).toBe('Failed to move node');
    });

    it('still scopes to the submitted form — a sibling dialog stays silent', () => {
      expect(scopedActionError<MoveForm>(
        { form: { data: { _kind: 'deleteNode' } } },
        'moveNode',
        { type: 'error', text: 'Failed to move node' },
        {},
        ['_kind'],
      )).toBeNull();
    });
  });
});
