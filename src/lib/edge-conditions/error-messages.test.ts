import { describe, it, expect } from 'vitest';
import { userFacingErrorMessage } from './error-messages.js';

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

  it('uses the message from the first error when extensions are absent', () => {
    const err = { response: { errors: [{ message: 'plain server error' }] } };
    expect(userFacingErrorMessage(err, 'Fallback')).toBe('plain server error');
  });
});
