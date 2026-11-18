import { describe, expect, it } from 'vitest';
import { cliRef, shellArg, wakeCommands } from './cli-command';

describe('shellArg', () => {
  it.each(['hrn:ticker:acme.com:team:engineering', 'tk-1', 'a.b_c-d:e'])('prints %s bare', (v) => {
    expect(shellArg(v)).toBe(v);
  });

  it('single-quotes anything else', () => {
    expect(shellArg('tk 1')).toBe("'tk 1'");
    expect(shellArg('a$b')).toBe("'a$b'");
    expect(shellArg('')).toBe("''");
  });

  it("writes ' as '\\''", () => {
    expect(shellArg("w liam's")).toBe("'w liam'\\''s'");
  });
});

describe('cliRef', () => {
  it('prefers the URN, then the id, then nothing', () => {
    expect(cliRef({ urn: 'hrn:x', id: 'i' })).toBe('hrn:x');
    expect(cliRef({ urn: null, id: 'i' })).toBe('i');
    expect(cliRef({ urn: '', id: 'i' })).toBe('i');
    expect(cliRef({ urn: null, id: '' })).toBeNull();
    expect(cliRef({})).toBeNull();
  });
});

describe('the commands', () => {
  // portal#1497 D4 removed tickerCommands with the ticker page's CLI block
  // (the portal controls replaced it); the wake-settings commands stay.

  it('wake settings, each with a setting', () => {
    expect(Object.values(wakeCommands('w-1'))).toEqual([
      'hadron team wake-settings set --worker w-1 --mentions off',
      'hadron team wake-settings set --worker w-1 --mentions immediate',
      'hadron team wake-settings set --worker w-1 --clear-pause',
      'hadron team wake-settings set --worker w-1 --paused-until <RFC3339>',
    ]);
  });
});
