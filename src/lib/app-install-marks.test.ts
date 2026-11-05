/** portal#1684 (hadron-server#3435). Fixtures keep the server's contract: every entry answers, or none does. */
import { describe, expect, it } from 'vitest';
import { installMarksOf } from './app-install-marks';

const importer = { id: 'a', name: 'Team', urn: 'hrn:agent:acme.com:team' };

describe('installMarksOf', () => {
  it('marks a row installed and a derived agent with its importer', () => {
    expect(installMarksOf([
      { agent: { id: 'a' }, installMethod: 'ROW', importer: null },
      { agent: { id: 'b' }, installMethod: 'DERIVED', importer },
    ])).toEqual({ a: { kind: 'installed' }, b: { kind: 'derived', importer } });
  });

  it('a withheld answer gives no mark on any entry, a row included', () => {
    expect(installMarksOf([
      { agent: { id: 'a' }, installMethod: null, importer: null },
      { agent: null, installMethod: null, importer: null },
      { agent: { id: 'b' }, installMethod: null, importer: null },
    ])).toEqual({});
  });

  it('DERIVED without an importer is outside the contract: no mark, never a guess', () => {
    expect(installMarksOf([{ agent: { id: 'b' }, installMethod: 'DERIVED', importer: null }])).toEqual({});
  });

  it('a withheld roster gives no marks', () => {
    expect(installMarksOf(null)).toEqual({});
    expect(installMarksOf(undefined)).toEqual({});
  });
});
