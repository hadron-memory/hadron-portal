/**
 * portal#1607 — an App's task integrations (hrn:node:hadronmemory.com:specs:cor:agt:120:01) as the form sees them:
 * read from App.properties, written back whole with every other key kept.
 */
import { describe, expect, it } from 'vitest';
import { leadStatus, readIntegrations, validateDrafts, writeProperties, type IntegrationDraft } from './task-integrations';

const wire = {
  name: 'core', provider: 'github', repositories: ['o/a', 'o/b'], readyLabel: 'ready', excludeLabels: ['wip'],
  teams: [{ lead: 'hrn:worker:x.com:app:iris', label: 'team:iris' }],
  futureKey: { keep: true },
};

describe('readIntegrations', () => {
  it('reads null, a non-object and a missing key as no integrations', () => {
    expect(readIntegrations(null)).toEqual([]);
    expect(readIntegrations('x')).toEqual([]);
    expect(readIntegrations({ other: 1 })).toEqual([]);
    expect(readIntegrations({ taskIntegrations: 'nope' })).toEqual([]);
  });
  it('reads every field, keeps a null lead as null, and carries unknown integration keys', () => {
    const [d] = readIntegrations({ taskIntegrations: [{ ...wire, teams: [{ lead: null, label: 'l' }] }] });
    expect(d).toMatchObject({ name: 'core', provider: 'github', repositories: ['o/a', 'o/b'], readyLabel: 'ready', excludeLabels: ['wip'] });
    expect(d.teams).toEqual([{ lead: null, label: 'l' }]);
    expect(d.extra).toEqual({ futureKey: { keep: true } });
  });
});

describe('writeProperties', () => {
  it('replaces only taskIntegrations: every other top-level key is kept as it was', () => {
    const current = { taskIntegrations: [wire], other: 1, nested: { a: [1, 2] } };
    const out = writeProperties(current, readIntegrations(current));
    expect(out.other).toBe(1);
    expect(out.nested).toEqual({ a: [1, 2] });
    expect(out.taskIntegrations).toEqual([wire]);
  });
  it('starts from an empty object when there are no properties yet', () => {
    const d: IntegrationDraft = { name: 'n', provider: 'github', repositories: ['o/r'], readyLabel: '', excludeLabels: [], teams: [], extra: {} };
    expect(writeProperties(null, [d])).toEqual({ taskIntegrations: [{ name: 'n', provider: 'github', repositories: ['o/r'] }] });
  });
  it('writes an empty list when the last integration is removed, keeping other keys', () => {
    expect(writeProperties({ taskIntegrations: [wire], other: 1 }, [])).toEqual({ taskIntegrations: [], other: 1 });
  });
});

describe('validateDrafts', () => {
  const ok: IntegrationDraft = { name: 'n', provider: 'github', repositories: ['o/r'], readyLabel: '', excludeLabels: [], teams: [{ lead: 'hrn:worker:x:y:z', label: 'l' }], extra: {} };
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
  it('a null lead stays unknown when the roster read failed', () => expect(leadStatus(null, null)).toEqual({ kind: 'unknown' }));
  it('marks a null lead unknown', () => expect(leadStatus(null, workers)).toEqual({ kind: 'unknown' }));
});
