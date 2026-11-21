import { describe, expect, it } from 'vitest';
import { addTracked, parseTracked, removeTracked, serializeTracked, TRACKED_MAX } from './tracked';

const O = 'https://h.example';
const U = 'https://h.example/secret-changes/a';
describe('tracked change requests (portal#2380)', () => {
  it('round-trips and drops malformed entries', () => {
    const list = [{ secretId: 's1', requestId: 'r1', ceremonyUrl: U }];
    expect(parseTracked(serializeTracked(list), O)).toEqual(list);
    expect(parseTracked('not json', O)).toEqual([]);
    expect(parseTracked(undefined, O)).toEqual([]);
    expect(parseTracked(JSON.stringify([{ secretId: 1, requestId: 'r' }, null, { secretId: 's', requestId: '' }, { secretId: 's', requestId: 'r', ceremonyUrl: 'javascript:1' }]), O)).toEqual([]);
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

describe('a staged create is tracked by its App and name (portal#2436)', () => {
  const create = { requestId: 'r1', ceremonyUrl: U, create: { appId: 'app-1', name: 'stripe-key' } };
  it('round-trips, without a secretId', () => {
    expect(parseTracked(serializeTracked([create]), O)).toEqual([create]);
  });
  it('drops a pre-typed `create:<app>:<name>` secretId, an entry with both shapes, and a create with no name', () => {
    const raw = JSON.stringify([
      { secretId: 'create:app-1:old', requestId: 'r1', ceremonyUrl: U },
      { ...create, secretId: 's1' },
      { requestId: 'r2', ceremonyUrl: U, create: { appId: 'app-1', name: '' } },
      { requestId: 'r3', ceremonyUrl: U, create: null },
    ]);
    expect(parseTracked(raw, O)).toEqual([]);
  });
});

describe('a tracked link is re-pinned on read (portal#2417)', () => {
  const row = (ceremonyUrl: string) => JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl }]);
  it('a cookie edited to name another host is dropped, so no attacker link renders', () => {
    expect(parseTracked(row('https://evil.example/secret-changes/a'), O)).toEqual([]);
    expect(parseTracked(row(U), O)).toHaveLength(1);
  });
  it('with no configured origin nothing is trusted', () => {
    expect(parseTracked(row(U), null)).toEqual([]);
  });
});
