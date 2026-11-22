import { describe, expect, it } from 'vitest';
import { wakeRolesCanManage } from './wake-roles-can-manage';

describe('wakeRolesCanManage (portal#2464)', () => {
  it('a known manager acting as themselves gets the controls', () => {
    expect(wakeRolesCanManage({ kind: 'known', manages: true }, false)).toBe(true);
  });
  it.each([
    ['a known non-manager', { kind: 'known', manages: false }, false],
    ['a manager while impersonating', { kind: 'known', manages: true }, true],
    ['an unknown read', { kind: 'unknown' }, false],
    ['no read', null, false],
    ['no read', undefined, false],
  ])('%s does not', (_n, vm, imp) => {
    expect(wakeRolesCanManage(vm as never, imp)).toBe(false);
  });
});
