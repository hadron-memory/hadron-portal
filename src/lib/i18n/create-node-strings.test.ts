import { describe, expect, it } from 'vitest';
import {
  badLocReason,
  createNodeErrorCode,
  isBadLocError,
  createNodeErrorStatus,
  translateCreateNodeError,
} from './create-node-strings';

function gqlError(code: string, message = 'something failed', reason?: string): unknown {
  return { response: { errors: [{ message, extensions: reason === undefined ? { code } : { code, reason } }] } };
}

describe('createNodeErrorCode', () => {
  it('extracts the typed code from a GraphQL error', () => {
    expect(createNodeErrorCode(gqlError('NodeLocConflictError'))).toBe('NodeLocConflictError');
    expect(createNodeErrorCode(gqlError('InvalidLocError'))).toBe('InvalidLocError');
  });

  it('returns null for non-GraphQL errors', () => {
    expect(createNodeErrorCode(null)).toBe(null);
    expect(createNodeErrorCode(undefined)).toBe(null);
    expect(createNodeErrorCode(new Error('plain'))).toBe(null);
    expect(createNodeErrorCode('string')).toBe(null);
  });

  it('returns null when extensions.code is absent', () => {
    expect(createNodeErrorCode({ response: { errors: [{ message: 'no code' }] } })).toBe(null);
    expect(createNodeErrorCode({ response: { errors: [] } })).toBe(null);
  });
});

describe('translateCreateNodeError', () => {
  it('translates NodeLocConflictError', () => {
    const text = translateCreateNodeError(gqlError('NodeLocConflictError'));
    expect(text).toMatch(/already exists/i);
  });

  it('translates InvalidLocError with a hint about allowed characters', () => {
    const text = translateCreateNodeError(gqlError('InvalidLocError'));
    expect(text).toMatch(/letters.*digits.*hyphens/i);
  });

  // A missing memory and one you can no longer read answer identically
  // (hrn:node:hadronmemory.com:specs:cor:api:140:03, team chat #2103), so the
  // copy must not claim it no longer exists.
  it('translates MemoryNotFoundError without claiming the memory is gone', () => {
    const text = translateCreateNodeError(gqlError('MemoryNotFoundError'));
    expect(text).toMatch(/isn’t available to you/);
    expect(text).not.toMatch(/exist/i);
  });

  it('translates Forbidden to no-write-access copy', () => {
    const text = translateCreateNodeError(gqlError('Forbidden'));
    expect(text).toMatch(/write access/i);
  });

  it('uses generic copy for unknown GraphQL codes', () => {
    const text = translateCreateNodeError(
      gqlError('SomeNewServerErrorClass', 'a specific server message'),
    );
    expect(text).toBe('Something went wrong on our side.');
  });

  it('falls back to Error.message for plain Error instances', () => {
    const text = translateCreateNodeError(new Error('something specific'));
    expect(text).toBe('something specific');
  });

  it('falls back to generic copy when input is not error-shaped', () => {
    const text = translateCreateNodeError(undefined);
    expect(text).toMatch(/couldn'?t create the node/i);
  });
});

describe('createNodeErrorStatus', () => {
  it('maps typed errors to 4xx', () => {
    expect(createNodeErrorStatus(gqlError('NodeLocConflictError'))).toBe(409);
    expect(createNodeErrorStatus(gqlError('InvalidLocError'))).toBe(400);
    expect(createNodeErrorStatus(gqlError('MemoryNotFoundError'))).toBe(404);
    expect(createNodeErrorStatus(gqlError('Forbidden'))).toBe(403);
  });

  it('maps unknown errors to 500', () => {
    expect(createNodeErrorStatus(gqlError('SomeNewError'))).toBe(500);
    expect(createNodeErrorStatus(new Error('plain'))).toBe(500);
    expect(createNodeErrorStatus(undefined)).toBe(500);
  });
});

// portal#2323: a bad loc is BAD_USER_INPUT + extensions.reason; the old
// InvalidLocError shape stays readable until the server change is deployed.
describe('bad loc reading (portal#2323)', () => {
  it('reads a reason from the set off BAD_USER_INPUT, and nothing else', () => {
    expect(badLocReason(gqlError('BAD_USER_INPUT', 'x', 'empty'))).toBe('empty');
    expect(badLocReason(gqlError('BAD_USER_INPUT', 'x', 'invalid-charset'))).toBe('invalid-charset');
    expect(badLocReason(gqlError('BAD_USER_INPUT', 'x', 'too-long'))).toBe('too-long');
    // #588 schema violation: no reason
    expect(badLocReason(gqlError('BAD_USER_INPUT'))).toBeNull();
    // a reason outside the set, and a reason on another code, are not a bad loc
    expect(badLocReason(gqlError('BAD_USER_INPUT', 'x', 'something-else'))).toBeNull();
    expect(badLocReason(gqlError('Forbidden', 'x', 'empty'))).toBeNull();
    expect(badLocReason(null)).toBeNull();
  });

  it('isBadLocError accepts both shapes and rejects a schema violation', () => {
    expect(isBadLocError(gqlError('BAD_USER_INPUT', 'x', 'too-long'))).toBe(true);
    expect(isBadLocError(gqlError('InvalidLocError'))).toBe(true);
    expect(isBadLocError(gqlError('BAD_USER_INPUT'))).toBe(false);
  });

  it('says a different thing per reason; invalid-charset keeps today\'s message', () => {
    const charset = translateCreateNodeError(gqlError('BAD_USER_INPUT', 'x', 'invalid-charset'));
    expect(charset).toBe(translateCreateNodeError(gqlError('InvalidLocError')));
    expect(charset).toMatch(/letters.*digits.*hyphens/i);
    const empty = translateCreateNodeError(gqlError('BAD_USER_INPUT', 'x', 'empty'));
    const tooLong = translateCreateNodeError(gqlError('BAD_USER_INPUT', 'x', 'too-long'));
    expect(empty).toMatch(/required/i);
    expect(tooLong).toMatch(/too long/i);
    expect(tooLong).not.toMatch(/letters/i); // the old text misdescribes this case
    expect(tooLong).not.toMatch(/\d/); // no cap number until the cor:api rule is minted
    expect(new Set([charset, empty, tooLong]).size).toBe(3);
  });

  it('a schema-violation BAD_USER_INPUT still passes the server text through', () => {
    expect(translateCreateNodeError(gqlError('BAD_USER_INPUT', 'properties.name: required field missing'))).toBe(
      'properties.name: required field missing',
    );
  });

  it('a bad loc is a 400', () => {
    expect(createNodeErrorStatus(gqlError('BAD_USER_INPUT', 'x', 'too-long'))).toBe(400);
  });
});
