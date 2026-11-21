import { describe, expect, it } from 'vitest';
import { addTracked, parseTracked, removeTracked, serializeTracked, TRACKED_MAX } from './tracked';

const U = 'https://h.example/secret-changes/a';
describe('tracked change requests (portal#2380)', () => {
  it('round-trips and drops malformed entries', () => {
    const list = [{ secretId: 's1', requestId: 'r1', ceremonyUrl: U }];
    expect(parseTracked(serializeTracked(list))).toEqual(list);
    expect(parseTracked('not json')).toEqual([]);
    expect(parseTracked(undefined)).toEqual([]);
    expect(parseTracked(JSON.stringify([{ secretId: 1, requestId: 'r' }, null, { secretId: 's', requestId: '' }, { secretId: 's', requestId: 'r', ceremonyUrl: 'javascript:1' }]))).toEqual([]);
  });
  it('adds once per request id and caps the list', () => {
    let l = addTracked([], { secretId: 's', requestId: 'r1', ceremonyUrl: U });
    l = addTracked(l, { secretId: 's', requestId: 'r1', ceremonyUrl: U });
    expect(l).toHaveLength(1);
    for (let i = 0; i < TRACKED_MAX + 3; i++) l = addTracked(l, { secretId: 's', requestId: `x${i}`, ceremonyUrl: U });
    expect(l).toHaveLength(TRACKED_MAX);
    expect(removeTracked(l, 'x12').some((x) => x.requestId === 'x12')).toBe(false);
  });
});
