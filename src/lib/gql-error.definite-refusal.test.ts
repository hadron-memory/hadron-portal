/**
 * portal#2196: isDefiniteRefusal proves a failed write was refused BEFORE any commit. The
 * `*_NOT_FOUND` suffix was too wide: an unrelated code ending that way read as a refusal and
 * released a lock on a write that may have committed. Only framework/access codes and the action's
 * own known refusal codes are definite (cor:api:260:01: a typed refusal keeps its own code, anything
 * else is not proof that nothing was written).
 */
import { describe, expect, it } from 'vitest';
import { isDefiniteRefusal } from '$lib/gql-error';

const gqlError = (code: string | null) => ({ response: { errors: [{ message: 'm', extensions: code ? { code } : {} }] } });

describe('isDefiniteRefusal (portal#2196)', () => {
  it('an unrelated *_NOT_FOUND stays uncertain', () => {
    expect(isDefiniteRefusal(gqlError('FOO_NOT_FOUND'))).toBe(false);
    expect(isDefiniteRefusal(gqlError('FOO_NOT_FOUND'), ['AGENT_NOT_FOUND', 'APP_NOT_FOUND'])).toBe(false);
  });

  it('a code is definite only when the action names it', () => {
    for (const code of ['AGENT_NOT_FOUND', 'APP_NOT_FOUND', 'WORKER_NOT_FOUND', 'WORKER_RETIRED']) {
      expect(isDefiniteRefusal(gqlError(code)), `${code} without a known list`).toBe(false);
      expect(isDefiniteRefusal(gqlError(code), [code]), `${code} in its own list`).toBe(true);
    }
  });

  it('the framework and access codes stay definite without a list', () => {
    for (const code of ['FORBIDDEN', 'UNAUTHENTICATED', 'BAD_USER_INPUT', 'NOT_FOUND']) expect(isDefiniteRefusal(gqlError(code))).toBe(true);
  });

  it('an internal error, no code and a transport failure are never definite', () => {
    expect(isDefiniteRefusal(gqlError('INTERNAL_SERVER_ERROR'), ['INTERNAL_SERVER_ERROR'])).toBe(false);
    expect(isDefiniteRefusal(gqlError(null))).toBe(false);
    expect(isDefiniteRefusal(new TypeError('fetch failed'))).toBe(false);
  });
});
