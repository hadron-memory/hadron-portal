import { describe, expect, it } from 'vitest';
import { parseTracked, READ_FAILURE_LIMIT, serializeTracked } from './tracked';

// portal#2578: the failure count rides in a browser-editable cookie, so only a small whole number is believed.
describe('the failure count in the tracked cookie', () => {
  const one = (extra: object) => parseTracked(JSON.stringify([{ requestId: 'r1', secretId: 's1', ...extra }]));
  it('survives a round trip, for a secret and for a staged create', () => {
    const list = [{ requestId: 'r1', secretId: 's1', misses: 2 }, { requestId: 'r2', create: { appId: 'a', name: 'n' }, misses: 1 }];
    expect(parseTracked(serializeTracked(list))).toEqual(list);
  });
  it.each([[0], [-1], [1.5], ['2'], [null], [READ_FAILURE_LIMIT + 1], [1e9]])('%s reads as no count', (bad) => {
    expect(one({ misses: bad })).toEqual([{ requestId: 'r1', secretId: 's1' }]);
  });
});
