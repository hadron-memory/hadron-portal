import { describe, expect, it } from 'vitest';
import { QUESTION_ACTION_KINDS, questionResultOf } from './action-kinds';

describe('questionResultOf (portal#2234): which action result the card owns', () => {
  it.each(QUESTION_ACTION_KINDS)('%s result belongs to the card', (kind) => {
    expect(questionResultOf({ kind, ok: false, error: 'x' })).toEqual({ kind, ok: false, error: 'x' });
  });
  it('another action, a message-only form, no form and a non-object are not the card\'s', () => {
    expect(questionResultOf({ kind: 'renameNode', ok: false, error: 'x' })).toBeNull();
    expect(questionResultOf({ error: 'x' })).toBeNull();
    expect(questionResultOf(null)).toBeNull();
    expect(questionResultOf(undefined)).toBeNull();
    expect(questionResultOf('answerQuestion')).toBeNull();
  });
});
