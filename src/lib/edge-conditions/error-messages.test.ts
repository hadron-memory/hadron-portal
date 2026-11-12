import { describe, it, expect } from 'vitest';
import { entryConditionErrorMessage, userFacingErrorMessage } from './error-messages.js';

describe('userFacingErrorMessage', () => {
  it('extracts the message from a graphql-request ClientError shape', () => {
    const err = {
      response: {
        errors: [
          {
            message: 'This conversation needs your password to unlock your private memory before it can continue. Please re-enter your password and try again.',
            extensions: {
              code: 'EDGE_CONDITION_FAILED',
              reason: 'MEMORY_ENCRYPTED_NO_KEY',
              messageId: 'edge-conditions.error.memory_encrypted_no_key',
              detail: { edgeId: 'edge-1' },
            },
          },
        ],
      },
    };
    const text = userFacingErrorMessage(err, 'Fallback');
    expect(text).toContain('password');
  });

  it('falls back to a plain Error message when no graphql shape', () => {
    expect(userFacingErrorMessage(new Error('boom'), 'Fallback')).toBe('boom');
  });

  it('uses the fallback when the value is not an error', () => {
    expect(userFacingErrorMessage('garbage', 'Fallback')).toBe('Fallback');
    expect(userFacingErrorMessage(null, 'Fallback')).toBe('Fallback');
  });

  it('uses generic copy when GraphQL extensions are absent', () => {
    const err = { response: { errors: [{ message: 'plain server error' }] } };
    expect(userFacingErrorMessage(err, 'Fallback')).toBe('Something went wrong on our side.');
  });
});

describe('entryConditionErrorMessage (S6 B3 contract)', () => {
  const wire = (extensions: Record<string, unknown>) => ({ response: { errors: [{ message: 'raw server words', extensions }] } });

  it('gives SCOPE_NOT_AVAILABLE_AT_START its own copy', () => {
    expect(entryConditionErrorMessage(wire({ code: 'INVALID_ENTRY_CONDITION', reason: 'SCOPE_NOT_AVAILABLE_AT_START' }), 'Fallback'))
      .toBe('A start condition can use only memory and agent facts.');
  });

  it.each(['INVALID_JSON', 'INVALID_JSONLOGIC', 'DISALLOWED_OPERATOR', 'UNKNOWN_SCOPE', 'RESERVED_NAME', 'AST_TOO_LARGE', 'AST_TOO_DEEP'])(
    'maps %s to the invalid start-condition copy, with no messageId needed',
    (reason) => {
      expect(entryConditionErrorMessage(wire({ code: 'INVALID_ENTRY_CONDITION', reason, detail: { field: 'x', operator: 'y' } }), 'Fallback'))
        .toBe("This start condition isn't valid. Check it and try again.");
    },
  );

  it('maps an unknown reason, or none, to the fallback and never the raw message', () => {
    expect(entryConditionErrorMessage(wire({ code: 'INVALID_ENTRY_CONDITION', reason: 'NEW_REASON' }), 'Fallback')).toBe('Fallback');
    expect(entryConditionErrorMessage(wire({ code: 'INVALID_ENTRY_CONDITION' }), 'Fallback')).toBe('Fallback');
  });

  it('leaves every other error to the existing mapper', () => {
    expect(entryConditionErrorMessage(new Error('boom'), 'Fallback')).toBe('boom');
  });
});
