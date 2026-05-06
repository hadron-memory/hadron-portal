import { describe, expect, it } from 'vitest';
import {
  createNodeErrorCode,
  createNodeErrorStatus,
  translateCreateNodeError,
} from './create-node-strings';

function gqlError(code: string, message = 'something failed'): unknown {
  return { response: { errors: [{ message, extensions: { code } }] } };
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

  it('translates MemoryNotFoundError', () => {
    const text = translateCreateNodeError(gqlError('MemoryNotFoundError'));
    expect(text).toMatch(/no longer exists/i);
  });

  it('translates Forbidden to no-write-access copy', () => {
    const text = translateCreateNodeError(gqlError('Forbidden'));
    expect(text).toMatch(/write access/i);
  });

  it('falls back to GraphQL error message for unknown codes', () => {
    const text = translateCreateNodeError(
      gqlError('SomeNewServerErrorClass', 'a specific server message'),
    );
    expect(text).toBe('a specific server message');
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
