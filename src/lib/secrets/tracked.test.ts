import { describe, expect, it } from 'vitest';
import { addTracked, parseTracked, removeTracked, serializeTracked, TRACKED_MAX } from './tracked';

describe('tracked change requests (portal#2380)', () => {
  it('round-trips and drops malformed entries', () => {
    const list = [{ secretId: 's1', requestId: 'r1' }];
    expect(parseTracked(serializeTracked(list))).toEqual(list);
    expect(parseTracked('not json')).toEqual([]);
    expect(parseTracked(undefined)).toEqual([]);
    expect(parseTracked(JSON.stringify([{ secretId: 1, requestId: 'r' }, null, { secretId: 's', requestId: '' }]))).toEqual([]);
  });
  it('adds once per request id and caps the list', () => {
    let l = addTracked([], { secretId: 's', requestId: 'r1' });
    l = addTracked(l, { secretId: 's', requestId: 'r1' });
    expect(l).toHaveLength(1);
    for (let i = 0; i < TRACKED_MAX + 3; i++) l = addTracked(l, { secretId: 's', requestId: `x${i}` });
    expect(l).toHaveLength(TRACKED_MAX);
    expect(removeTracked(l, 'x12').some((x) => x.requestId === 'x12')).toBe(false);
  });
});

describe('a staged create is tracked by its App and name (portal#2436)', () => {
  const create = { requestId: 'r1', create: { appId: 'app-1', name: 'stripe-key' } };
  it('round-trips, without a secretId', () => {
    expect(parseTracked(serializeTracked([create]))).toEqual([create]);
  });
  it('drops a pre-typed `create:<app>:<name>` secretId, an entry with both shapes, and a create with no name', () => {
    const raw = JSON.stringify([
      { secretId: 'create:app-1:old', requestId: 'r1' },
      { ...create, secretId: 's1' },
      { requestId: 'r2', create: { appId: 'app-1', name: '' } },
      { requestId: 'r3', create: null },
    ]);
    expect(parseTracked(raw)).toEqual([]);
  });
});

describe('the cookie carries no URL (portal#2417)', () => {
  const row = (ceremonyUrl: string) => JSON.stringify([{ secretId: 's1', requestId: 'r1', ceremonyUrl }]);
  it('an entry is kept by its ids whatever URL field it carries: the field is not read, so no planted URL matters', () => {
    // The link is rebuilt from the pinned origin at render; a ≤2h-old cookie (written with a URL)
    // keeps working, and a sibling-subdomain plant changes nothing the portal renders.
    expect(parseTracked(row('https://evil.example/secret-changes/a'))).toEqual([{ secretId: 's1', requestId: 'r1' }]);
    expect(parseTracked(row('javascript:alert(1)'))).toEqual([{ secretId: 's1', requestId: 'r1' }]);
    expect(parseTracked(row('not a url'))).toEqual([{ secretId: 's1', requestId: 'r1' }]);
  });
  it('a written cookie never contains a ceremonyUrl, and a rewrite drops one it read', () => {
    const out = serializeTracked(parseTracked(row('https://evil.example/secret-changes/a')));
    expect(out).toBe(JSON.stringify([{ secretId: 's1', requestId: 'r1' }]));
    expect(out).not.toContain('ceremonyUrl');
  });
});
