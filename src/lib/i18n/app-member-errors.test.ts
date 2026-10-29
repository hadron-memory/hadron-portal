import { describe, expect, it } from 'vitest';
import {
  appMemberErrorCode,
  appMemberErrorStatus,
  translateAppMemberError,
} from './app-member-errors';

function gqlError(code: string, message = 'something failed'): unknown {
  return { response: { errors: [{ message, extensions: { code } }] } };
}

describe('appMemberErrorCode', () => {
  it('extracts the typed code from a GraphQL error', () => {
    expect(appMemberErrorCode(gqlError('InvalidRoleError'))).toBe('InvalidRoleError');
    expect(appMemberErrorCode(gqlError('MaxMembersExceededError'))).toBe('MaxMembersExceededError');
  });

  it('returns null when the input is not a GraphQL error', () => {
    expect(appMemberErrorCode(null)).toBe(null);
    expect(appMemberErrorCode(undefined)).toBe(null);
    expect(appMemberErrorCode(new Error('plain'))).toBe(null);
    expect(appMemberErrorCode('string')).toBe(null);
  });

  it('returns null when extensions.code is absent', () => {
    expect(appMemberErrorCode({ response: { errors: [{ message: 'no code' }] } })).toBe(null);
    expect(appMemberErrorCode({ response: { errors: [] } })).toBe(null);
  });
});

describe('translateAppMemberError', () => {
  it('returns a friendly message for each typed error', () => {
    expect(translateAppMemberError(gqlError('InvalidRoleError'), 'fallback')).toMatch(/role/i);
    expect(translateAppMemberError(gqlError('MaxMembersExceededError'), 'fallback')).toMatch(/limit/i);
    expect(translateAppMemberError(gqlError('MissingGrantError'), 'fallback')).toMatch(/licensed/i);
    expect(translateAppMemberError(gqlError('OrphanAppError'), 'fallback')).toMatch(/Agent linked/i);
  });

  it('uses generic copy for unknown GraphQL codes', () => {
    const err = gqlError('SomeFutureError', 'specific server message');
    expect(translateAppMemberError(err, 'generic fallback')).toBe('Something went wrong on our side.');
  });

  it('uses the caller fallback when the input has no message at all', () => {
    expect(translateAppMemberError({}, 'caller fallback')).toBe('caller fallback');
  });

  it('uses Error.message for plain Error instances', () => {
    expect(translateAppMemberError(new Error('boom'), 'fallback')).toBe('boom');
  });
});

describe('appMemberErrorStatus', () => {
  it('returns the right HTTP status per typed code', () => {
    expect(appMemberErrorStatus(gqlError('InvalidRoleError'))).toBe(400);
    expect(appMemberErrorStatus(gqlError('MaxMembersExceededError'))).toBe(409);
    expect(appMemberErrorStatus(gqlError('MissingGrantError'))).toBe(403);
    expect(appMemberErrorStatus(gqlError('OrphanAppError'))).toBe(409);
  });

  it('returns 500 for unknown / untyped errors', () => {
    expect(appMemberErrorStatus(gqlError('SomeFutureError'))).toBe(500);
    expect(appMemberErrorStatus(new Error('plain'))).toBe(500);
    expect(appMemberErrorStatus(null)).toBe(500);
    expect(appMemberErrorStatus({})).toBe(500);
  });
});
