/**
 * portal#1142 P0a — the include refusals hadron-server#2040 (S1) returns on a
 * write, read off the GraphQL error and shown as the server said them: the
 * message whole, the offending tag beside it, and what to do next.
 */
import { describe, expect, it } from 'vitest';
import { includeRefusalOf, includeRefusalText } from './include-refusal';

function gqlError(code: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('raw ClientError text with the query and variables'), {
    response: { errors: [{ message, extensions: { code, ...extra } }] },
  });
}

describe('includeRefusalOf', () => {
  it.each(['INVALID_INCLUDE', 'INCLUDE_CYCLE', 'INCLUDE_TOO_DEEP', 'INCLUDE_EDGE_DERIVED'])(
    'reads %s with its message and tag',
    (code) => {
      expect(includeRefusalOf(gqlError(code, `server says ${code}`, { tag: '{{> a}}' }))).toEqual({
        code,
        message: `server says ${code}`,
        tag: '{{> a}}',
      });
    },
  );

  it('reports no tag when the server sent none, or sent a non-string', () => {
    expect(includeRefusalOf(gqlError('INCLUDE_TOO_DEEP', 'deep'))?.tag).toBeNull();
    expect(includeRefusalOf(gqlError('INCLUDE_TOO_DEEP', 'deep', { tag: 42 }))?.tag).toBeNull();
  });

  it('is null for any other refusal, and for a transport error', () => {
    expect(includeRefusalOf(gqlError('BAD_USER_INPUT', 'nope', { tag: '{{> a}}' }))).toBeNull();
    expect(includeRefusalOf(gqlError('NODE_WRITE_CONFLICT', 'changed'))).toBeNull();
    expect(includeRefusalOf(new Error('ECONNREFUSED'))).toBeNull();
  });
});

describe('includeRefusalText', () => {
  it('keeps the server message whole and names the tag', () => {
    const text = includeRefusalText({ code: 'INCLUDE_CYCLE', message: 'Include {{> a}} would make this node include itself.', tag: '{{> a}}' });
    expect(text).toContain('Include {{> a}} would make this node include itself.');
    expect(text).toContain('Tag: {{> a}}');
    expect(text).toContain('Fix or remove that include tag, then save again.');
  });

  it('omits the tag line when there is no tag', () => {
    const text = includeRefusalText({ code: 'INCLUDE_TOO_DEEP', message: 'Includes nest too deep.', tag: null });
    expect(text).not.toContain('Tag:');
    expect(text).toContain('Includes nest too deep.');
  });

  it('points a derived-edge refusal at the source content, not at a tag to fix', () => {
    const text = includeRefusalText({ code: 'INCLUDE_EDGE_DERIVED', message: 'This edge is derived.', tag: null });
    expect(text).toContain('This edge is derived.');
    expect(text).toContain("change that node's content instead");
    expect(text).not.toContain('save again');
  });

  // Xylon's stamp: no claim about the write-depth limit from current server
  // code. The server's own message may name a number; the portal's words don't.
  it('adds no depth number of its own', () => {
    expect(includeRefusalText({ code: 'INCLUDE_TOO_DEEP', message: 'm', tag: null })).not.toMatch(/\d/);
  });
});
