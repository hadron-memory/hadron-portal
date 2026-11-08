/**
 * portal#1607 — an App's task integrations (hrn:node:hadronmemory.com:specs:cor:agt:120:01) as the form sees them:
 * read from App.properties, written back whole with every other key kept.
 */
import { describe, expect, it } from 'vitest';
import {
  TASK_INTEGRATION_PROVIDERS,
  blankIntegration,
  isUnsupported,
  leadStatus,
  parseDrafts,
  readIntegrations,
  validateDrafts,
  writeProperties,
  type IntegrationDraft,
} from './task-integrations';

const wire = {
  name: 'core', provider: 'github', repositories: ['o/a', 'o/b'], readyLabel: 'ready', excludeLabels: ['wip'],
  teams: [{ lead: 'hrn:worker:x.com:app:iris', label: 'team:iris' }],
};

describe('readIntegrations', () => {
  it('reads null, a non-object and a missing key as no integrations', () => {
    expect(readIntegrations(null)).toEqual([]);
    expect(readIntegrations('x')).toEqual([]);
    expect(readIntegrations({ other: 1 })).toEqual([]);
    expect(readIntegrations({ taskIntegrations: 'nope' })).toEqual([]);
  });
  it('reads every field and keeps a null lead as null', () => {
    const [d] = readIntegrations({ taskIntegrations: [{ ...wire, teams: [{ lead: null, label: 'l' }] }] });
    expect(d).toMatchObject({ name: 'core', provider: 'github', repositories: ['o/a', 'o/b'], readyLabel: 'ready', excludeLabels: ['wip'] });
    expect((d as IntegrationDraft).teams).toEqual([{ lead: null, label: 'l' }]);
    expect(d).not.toHaveProperty('extra');
  });
  // portal#1679 U1-U3: what the portal can't represent stays visible as "unsupported"; it is never read as GitHub, dropped or coerced.
  it('U1: an unknown provider is unsupported, with its index and provider text, never read as github', () => {
    const entries = readIntegrations({ taskIntegrations: [wire, { ...wire, provider: 'linear' }] });
    expect(entries).toHaveLength(2);
    expect(isUnsupported(entries[0])).toBe(false);
    expect(entries[1]).toEqual({ unsupported: true, index: 1, provider: 'linear' });
  });
  it('U2: a non-object entry and a wrong-typed field are unsupported; the count is preserved', () => {
    const entries = readIntegrations({ taskIntegrations: [wire, 42, { ...wire, repositories: 5 }, null, { ...wire, name: 7 }] });
    expect(entries).toHaveLength(5);
    expect(entries.map(isUnsupported)).toEqual([false, true, true, true, true]);
    expect(entries[1]).toEqual({ unsupported: true, index: 1, provider: null });
    expect(entries[2]).toEqual({ unsupported: true, index: 2, provider: 'github' });
  });
  it('U3: an unknown integration key, or an unknown team key, makes the entry unsupported (nothing is carried in extra)', () => {
    const entries = readIntegrations({ taskIntegrations: [{ ...wire, futureKey: { keep: true } }, { ...wire, teams: [{ lead: 'x', label: 'l', rank: 1 }] }] });
    expect(entries.map(isUnsupported)).toEqual([true, true]);
  });
  it('a provider that is not a string is unsupported with a null provider', () => {
    expect(readIntegrations({ taskIntegrations: [{ ...wire, provider: { a: 1 } }] })[0]).toEqual({ unsupported: true, index: 0, provider: null });
  });
});

describe('writeProperties', () => {
  it('replaces only taskIntegrations: every other top-level key is kept as it was', () => {
    const current = { taskIntegrations: [wire], other: 1, nested: { a: [1, 2] } };
    const out = writeProperties(current, readIntegrations(current) as IntegrationDraft[]);
    expect(out.other).toBe(1);
    expect(out.nested).toEqual({ a: [1, 2] });
    expect(out.taskIntegrations).toEqual([wire]);
  });
  it('starts from an empty object when there are no properties yet', () => {
    const d: IntegrationDraft = { name: 'n', provider: 'github', repositories: ['o/r'], readyLabel: '', excludeLabels: [], teams: [] };
    expect(writeProperties(null, [d])).toEqual({ taskIntegrations: [{ name: 'n', provider: 'github', repositories: ['o/r'] }] });
  });
  it('writes an empty list when the last integration is removed, keeping other keys', () => {
    expect(writeProperties({ taskIntegrations: [wire], other: 1 }, [])).toEqual({ taskIntegrations: [], other: 1 });
  });
});

describe('validateDrafts', () => {
  const ok: IntegrationDraft = { name: 'n', provider: 'github', repositories: ['o/r'], readyLabel: '', excludeLabels: [], teams: [{ lead: 'hrn:worker:x:y:z', label: 'l' }] };
  it('accepts a good draft', () => expect(validateDrafts([ok])).toEqual({}));
  it('keys each error by the server\'s path', () => {
    const bad = { ...ok, name: ' ', repositories: ['o/r', 'nonsense'], teams: [{ lead: null, label: '' }] };
    const e = validateDrafts([bad]);
    expect(Object.keys(e).sort()).toEqual([
      'taskIntegrations[0].name', 'taskIntegrations[0].repositories[1]',
      'taskIntegrations[0].teams[0].label', 'taskIntegrations[0].teams[0].lead',
    ]);
  });
  it('requires 1 to 50 repositories', () => {
    expect(validateDrafts([{ ...ok, repositories: [] }])['taskIntegrations[0].repositories']).toBeTruthy();
    expect(validateDrafts([{ ...ok, repositories: Array.from({ length: 51 }, (_, i) => `o/r${i}`) }])['taskIntegrations[0].repositories']).toBeTruthy();
  });
  it('does not block a retired lead in the browser: the server refuses it at the lead', () => {
    expect(validateDrafts([{ ...ok, teams: [{ lead: 'hrn:worker:x:y:retired', label: 'l' }] }])).toEqual({});
  });
});

describe('leadStatus', () => {
  const workers = [
    { id: 'w1', name: 'Iris', urn: 'hrn:worker:x:y:iris', retiredAt: null },
    { id: 'w2', name: 'Old', urn: 'hrn:worker:x:y:old', retiredAt: '2026-10-01T00:00:00Z' },
  ];
  it('names a live lead', () => expect(leadStatus('hrn:worker:x:y:iris', workers)).toEqual({ kind: 'live', name: 'Iris', urn: 'hrn:worker:x:y:iris' }));
  it('marks a retired lead, by name when known', () => expect(leadStatus('hrn:worker:x:y:old', workers)).toEqual({ kind: 'retired', name: 'Old', urn: 'hrn:worker:x:y:old' }));
  it('a lead the roster does not hold is missing, never retired', () => expect(leadStatus('hrn:worker:x:y:gone', workers)).toEqual({ kind: 'missing', urn: 'hrn:worker:x:y:gone' }));
  it('a failed roster read checks nobody, not even a lead it would have named', () => expect(leadStatus('hrn:worker:x:y:old', null)).toEqual({ kind: 'unchecked', urn: 'hrn:worker:x:y:old' }));
  it('an undefined roster is unchecked too, never a throw', () => expect(leadStatus('hrn:worker:x:y:old', undefined as unknown as null)).toEqual({ kind: 'unchecked', urn: 'hrn:worker:x:y:old' }));
  it('a null lead stays unknown when the roster read failed', () => expect(leadStatus(null, null)).toEqual({ kind: 'unknown' }));
  it('marks a null lead unknown', () => expect(leadStatus(null, workers)).toEqual({ kind: 'unknown' }));
});


describe('parseDrafts (the crafted-POST shape check)', () => {
  const good = (): IntegrationDraft => ({ name: 'n', provider: 'github', repositories: ['o/r'], readyLabel: '', excludeLabels: [], teams: [{ lead: 'hrn:worker:x:y:z', label: 'l' }] });
  it('P1: a blank() draft and a draft read from a valid stored entry both pass', () => {
    expect(parseDrafts([blankIntegration()])).not.toBeNull();
    const [d] = readIntegrations({ taskIntegrations: [wire] });
    expect(parseDrafts([d])).not.toBeNull();
  });
  it('U7: refuses a draft with a key outside the managed set (extra included), a non-constant provider or a malformed field', () => {
    for (const bad of [{ ...good(), extra: {} }, { ...good(), futureKey: 1 }, { ...good(), provider: 'gitlab' }, { ...good(), name: 5 }, { ...good(), teams: [{ lead: 'x', label: 'l', rank: 1 }] }, { unsupported: true, index: 0, provider: 'linear' }]) {
      expect(parseDrafts([bad])).toBeNull();
    }
  });
  it('W1 (wiring control, NOT provider admission): the gate and the read derive from the one constant', () => {
    const providers = TASK_INTEGRATION_PROVIDERS as unknown as string[];
    expect(parseDrafts([{ ...good(), provider: 'linear' }])).toBeNull();
    providers.push('linear');
    try {
      expect(parseDrafts([{ ...good(), provider: 'linear' }])).not.toBeNull();
      expect(isUnsupported(readIntegrations({ taskIntegrations: [{ ...wire, provider: 'linear' }] })[0])).toBe(false);
    } finally {
      providers.pop();
    }
    expect(parseDrafts([{ ...good(), provider: 'linear' }])).toBeNull();
  });
  it('blankIntegration() takes its provider from the constant', () => expect(blankIntegration().provider).toBe(TASK_INTEGRATION_PROVIDERS[0]));
});

describe('readIntegrations: a wrong-typed optional field is unsupported, never coerced (#1695 review, §10 P3-5)', () => {
  const base = { name: 'core', provider: 'github', repositories: ['o/a'] };
  it('excludeLabels that is not a list of strings', () => {
    expect(readIntegrations({ taskIntegrations: [{ ...base, excludeLabels: 5 }] })[0]).toMatchObject({ unsupported: true });
    expect(readIntegrations({ taskIntegrations: [{ ...base, excludeLabels: ['ok', 7] }] })[0]).toMatchObject({ unsupported: true });
  });
  it('readyLabel that is not a string', () => {
    expect(readIntegrations({ taskIntegrations: [{ ...base, readyLabel: 7 }] })[0]).toMatchObject({ unsupported: true });
  });
});
