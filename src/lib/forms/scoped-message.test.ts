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
});
