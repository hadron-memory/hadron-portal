// #1653 QA P2: the list re-read refuses a malformed payload before it renders.
import { describe, expect, it } from 'vitest';
import { parseKeyList } from './key-list';

const good = { id: 'k1', keyPreview: 'abcd', label: null, createdAt: '2026-10-28T00:00:00Z', lastUsedAt: null, revokedAt: null, hiddenAt: null, issuedVia: 'portal' };

describe('parseKeyList', () => {
  it('keeps a well-formed list, field for field, and nothing else', () => {
    expect(parseKeyList({ keys: [{ ...good, extra: 'dropped' }] })).toEqual([good]);
    expect(parseKeyList({ keys: [] })).toEqual([]);
  });

  it.each([null, 'x', {}, { keys: 'x' }, { failed: true }])('refuses a non-list payload %j', (body) => {
    expect(parseKeyList(body)).toBeNull();
  });

  it.each([
    ['id', 7], ['id', ''], ['keyPreview', null], ['createdAt', undefined],
    ['label', 3], ['lastUsedAt', {}], ['revokedAt', 1], ['hiddenAt', true], ['issuedVia', []],
  ] as const)('refuses the whole list when one key has %s = %j', (field, value) => {
    expect(parseKeyList({ keys: [good, { ...good, [field]: value }] })).toBeNull();
  });
});
