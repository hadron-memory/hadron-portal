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
  });

  it('falls back to field errors for the submitted kind', () => {
    expect(scopedActionError<ExampleForm>(
      actionData(),
      'example',
      null,
      { id: ['Missing id.'], _kind: ['Wrong action.'] },
      ['id', '_kind'],
    )).toBe('Missing id.');
  });

  it('returns a success message only for the submitted kind', () => {
    const message = { type: 'success' as const, text: 'Saved.' };

    expect(scopedActionSuccess<ExampleForm>(actionData(), 'example', message)).toBe('Saved.');
    expect(scopedActionSuccess<ExampleForm>(actionData('other'), 'example', message)).toBeNull();
    expect(scopedActionSuccess<ExampleForm>(actionData(), 'example', { type: 'error', text: 'Nope.' })).toBeNull();
  });
});
