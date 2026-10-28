/**
 * portal#1142 P0a — the include refusals hadron-server#2040 (S1) returns on a
 * write, read off the GraphQL error and shown as the server said them: the
 * message whole, the offending tag beside it, and what to do next.
 */
import { describe, expect, it } from 'vitest';
import { INCLUDE_REFUSAL_CODES, includeRefusalOf, includeRefusalText } from './include-refusal';

function gqlError(code: string, message: string, extra: Record<string, unknown> = {}) {
  return Object.assign(new Error('raw ClientError text with the query and variables'), {
    response: { errors: [{ message, extensions: { code, ...extra } }] },
  });
}

describe('includeRefusalOf', () => {
  it.each(['INVALID_INCLUDE', 'INCLUDE_CYCLE', 'INCLUDE_TARGET_UNAVAILABLE', 'INCLUDE_TOO_DEEP', 'INCLUDE_EDGE_DERIVED'])(
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

// portal#1142 S2b (hadron-server#2226; Xylon's gate 6329041498).
describe('S2b: INCLUDE_TARGET_UNAVAILABLE and the per-write next step', () => {
  it('recognizes exactly the four current codes plus the legacy depth code', () => {
    expect([...INCLUDE_REFUSAL_CODES].sort()).toEqual(
      ['INCLUDE_CYCLE', 'INCLUDE_EDGE_DERIVED', 'INCLUDE_TARGET_UNAVAILABLE', 'INCLUDE_TOO_DEEP', 'INVALID_INCLUDE'],
    );
    expect(includeRefusalOf(gqlError('INCLUDE_TARGET_MISSING', 'x'))).toBeNull();
    expect(includeRefusalOf(gqlError('include_target_unavailable', 'x'))).toBeNull();
  });

  it('a payloadless error is not an include refusal', () => {
    expect(includeRefusalOf(Object.assign(new Error('raw'), { response: { errors: [{ message: 'm' }] } }))).toBeNull();
    expect(includeRefusalOf(Object.assign(new Error('raw'), { response: {} }))).toBeNull();
    expect(includeRefusalOf(undefined)).toBeNull();
  });

  const unavailable = { code: 'INCLUDE_TARGET_UNAVAILABLE' as const, message: 'Include {{> x}} names a node you cannot read.', tag: '{{> x}}' };

  it('edit and create keep the draft sentence', () => {
    for (const context of ['edit', 'create'] as const) {
      const text = includeRefusalText(unavailable, context);
      expect(text).toContain(unavailable.message);
      expect(text).toContain('Tag: {{> x}}.');
      expect(text).toContain('Your edit is still here.');
    }
  });

  it('merge and restore say nothing changed, and never offer a draft or a save', () => {
    const merge = includeRefusalText(unavailable, 'merge');
    expect(merge).toContain('Nothing was merged, and both nodes are unchanged.');
    const restore = includeRefusalText(unavailable, 'restore');
    expect(restore).toContain('Nothing was restored, and the node is unchanged.');
    for (const text of [merge, restore]) {
      expect(text).toContain(unavailable.message);
      expect(text).toContain('Tag: {{> x}}.');
      expect(text).not.toContain('Your edit is still here');
      expect(text).not.toContain('save again');
    }
  });

  it('never says why the target was unavailable', () => {
    for (const context of ['edit', 'create', 'merge', 'restore'] as const) {
      const portalWords = includeRefusalText({ ...unavailable, message: '', tag: null }, context);
      expect(portalWords).not.toMatch(/missing|deleted|permission|access|exist/i);
    }
  });
});
