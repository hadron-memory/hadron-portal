import { describe, expect, it } from 'vitest';
import { caseMismatchHint, roleSuggestionsFromRules, type RoleRuleRow } from './node-role-rules';

const row = (role: string, over: Partial<RoleRuleRow> = {}): RoleRuleRow => ({
  role, enabled: true, writers: 'ALL', descriptionNode: null, descriptionNodeState: 'NONE', ...over,
});

describe('roleSuggestionsFromRules (#1670)', () => {
  it('suggests every row, enabled or not, marking the disabled ones (FIT delta A)', () => {
    const s = roleSuggestionsFromRules([row('spec.feature', { enabled: false }), row('spec')]);
    expect(s.map((x) => [x.role, x.disabled])).toEqual([['spec', false], ['spec.feature', true]]);
  });
  it('keeps nested roles verbatim', () => {
    expect(roleSuggestionsFromRules([row('a.b.c')])[0].role).toBe('a.b.c');
  });
  it('marks an OWNER-writers role as refusing every write (FIT delta C), not ADMIN or ALL', () => {
    const s = roleSuggestionsFromRules([row('a', { writers: 'OWNER' }), row('b', { writers: 'ADMIN' }), row('c')]);
    expect(s.map((x) => x.refusesAllWrites)).toEqual([true, false, false]);
  });
  it('links the description only when its state is OK', () => {
    const s = roleSuggestionsFromRules([
      row('a', { descriptionNode: 'hrn:node:x:y:d', descriptionNodeState: 'OK' }),
      row('b', { descriptionNode: 'hrn:node:x:y:d', descriptionNodeState: 'UNREADABLE' }),
      row('c', { descriptionNode: null, descriptionNodeState: 'OK' }),
    ]);
    expect(s.map((x) => x.descriptionUrn)).toEqual(['hrn:node:x:y:d', null, null]);
  });
  it('a declare-only row (no tasks) is still a suggestion', () => {
    expect(roleSuggestionsFromRules([row('declared.only')])).toHaveLength(1);
  });
});

describe('caseMismatchHint (#1670, FIT delta B)', () => {
  const s = roleSuggestionsFromRules([row('spec.feature'), row('Mixed')]);
  it('names the declared role a differently-cased value would be', () => {
    expect(caseMismatchHint('Spec.Feature', s)).toBe('spec.feature');
    expect(caseMismatchHint('  SPEC.FEATURE ', s)).toBe('spec.feature');
  });
  it('is silent for an exact match, empty, unrelated, or an already-lowercase miss', () => {
    expect(caseMismatchHint('spec.feature', s)).toBeNull();
    expect(caseMismatchHint('Mixed', s)).toBeNull();
    expect(caseMismatchHint('', s)).toBeNull();
    expect(caseMismatchHint('other', s)).toBeNull();
    expect(caseMismatchHint('spec.feature2', s)).toBeNull();
  });
});
