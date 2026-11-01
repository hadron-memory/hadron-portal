/**
 * #957 — `failedSubmission` carries a draft over only from a FAILED post.
 */
import { describe, expect, it } from 'vitest';
import { failedSubmission, submittedForm } from './submitted-form';

type F = { _kind?: string; body: string };
const action = (valid: boolean, message?: { type: 'success' | 'error'; text: string }, kind = 'postTeamChatMessage') => ({
  form: { id: 'f', valid, posted: true, errors: {}, data: { _kind: kind, body: 'sent' }, message },
});

describe('failedSubmission', () => {
  it('is null for a successful post, which submittedForm still returns', () => {
    const ok = action(true, { type: 'success', text: 'Posted.' });
    expect(submittedForm<F>(ok, 'postTeamChatMessage')).not.toBeNull();
    expect(failedSubmission<F>(ok, 'postTeamChatMessage')).toBeNull();
    expect(failedSubmission<F>(action(true), 'postTeamChatMessage')).toBeNull(); // valid, no message
  });

  it('returns the form for a validation refusal or a server error', () => {
    expect(failedSubmission<F>(action(false), 'postTeamChatMessage')?.data.body).toBe('sent');
    expect(failedSubmission<F>(action(true, { type: 'error', text: 'Failed.' }), 'postTeamChatMessage')?.data.body).toBe('sent');
  });

  it('ignores another form\'s action data and anything that is not a form', () => {
    expect(failedSubmission<F>(action(false, undefined, 'castWorker'), 'postTeamChatMessage')).toBeNull();
    for (const data of [null, undefined, 'x', {}, { form: null }]) {
      expect(failedSubmission<F>(data, 'postTeamChatMessage')).toBeNull();
    }
  });

  // #1522 — the optional formId gate. Both chat send surfaces share a `_kind`
  // (one schema), so `_kind` alone cannot tell whose result it is: a sibling
  // form's failure — or a stale result that outlived a navigation — must not
  // seed this form just because the kind matches.
  it('with formId, ignores a matching-kind result posted under another form id', () => {
    const failOnNodeA = {
      form: { id: 'sendChatMessage:node-a', valid: false, posted: true, errors: {}, data: { _kind: 'sendChatMessage', body: 'sent' } },
    };
    expect(failedSubmission<F>(failOnNodeA, 'sendChatMessage', 'sendChatMessage:node-b')).toBeNull();
    expect(failedSubmission<F>(failOnNodeA, 'sendChatMessage', 'sendChatMessage:node-a')?.data.body).toBe('sent');
    // Omitted formId keeps the kind-only behavior for callers that have no
    // sibling sharing their schema.
    expect(failedSubmission<F>(failOnNodeA, 'sendChatMessage')?.data.body).toBe('sent');
  });
});
