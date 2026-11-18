/**
 * portal#1607 — the App properties read and the task-integrations write
 * (setAppProperties, hrn:node:hadronmemory.com:specs:cor:dmo:050:20): whole replace with expectedRevision,
 * a conflict is reported and never retried, a path-bearing refusal is surfaced.
 */
import { describe, expect, it, vi } from 'vitest';
import { blankIntegration, isUnsupported, readIntegrations, type IntegrationDraft } from '$lib/task-integrations';
import { loadAppProperties, saveTaskIntegrations } from './app-properties';
import { APP_PROPERTIES_QUERY, SET_APP_PROPERTIES_MUTATION } from './queries';

const wire = { name: 'core', provider: 'github', repositories: ['o/a'], teams: [{ lead: 'hrn:worker:x:y:iris', label: 'l' }] };
const refusal = (code: string, extensions: Record<string, unknown> = {}) =>
  Object.assign(new Error('x'), { response: { errors: [{ message: `server says ${code}`, extensions: { code, ...extensions } }] } });

function client(read: unknown, write?: (vars: any) => unknown) {
  const request = vi.fn(async (doc: string, vars: any) => {
    if (doc === APP_PROPERTIES_QUERY) {
      if (read instanceof Error) throw read;
      return { app: read };
    }
    if (doc === SET_APP_PROPERTIES_MUTATION) return write ? write(vars) : { setAppProperties: { id: 'a', propertiesRevision: 4 } };
    throw new Error('unexpected request');
  });
  return { request } as any;
}
const form = (integrations: unknown, revision: string | null = '3') => {
  const f = new FormData();
  f.set('integrations', JSON.stringify(integrations));
  if (revision !== null) f.set('revision', revision);
  return f;
};
const writes = (c: any) => c.request.mock.calls.filter((x: any[]) => x[0] === SET_APP_PROPERTIES_MUTATION);

describe('loadAppProperties', () => {
  it('a null revision is hidden (the caller may not read), never an empty section', async () => {
    expect(await loadAppProperties(client({ id: 'a', properties: null, propertiesRevision: null }), 'a')).toEqual({ kind: 'hidden' });
  });
  it('null properties with revision 0 is an empty, readable section', async () => {
    expect(await loadAppProperties(client({ id: 'a', properties: null, propertiesRevision: 0 }), 'a')).toEqual({ kind: 'ok', properties: null, revision: 0 });
  });
  it('an error or a missing App is failed, not hidden', async () => {
    expect(await loadAppProperties(client(new Error('boom')), 'a')).toEqual({ kind: 'failed' });
    expect(await loadAppProperties(client(null), 'a')).toEqual({ kind: 'failed' });
  });
});

describe('saveTaskIntegrations', () => {
  const current = { id: 'a', properties: { taskIntegrations: [wire], other: 1 }, propertiesRevision: 3 };
  it('sends the current object with only taskIntegrations changed, and the revision it read', async () => {
    const c = client(current);
    const r = await saveTaskIntegrations(c, 'a', form([{ ...wire, name: 'renamed', readyLabel: '', excludeLabels: [], teams: wire.teams }]));
    expect(r).toEqual({ ok: true, revision: 4 });
    expect(writes(c)).toHaveLength(1);
    const vars = writes(c)[0][1];
    expect(vars.expectedRevision).toBe(3);
    expect(vars.appRef).toBe('a');
    expect(vars.properties.other).toBe(1);
    expect(vars.properties.taskIntegrations[0].name).toBe('renamed');
  });
  it('reports APP_PROPERTIES_CONFLICT with the current revision and sends no second write', async () => {
    const c = client(current, () => { throw refusal('APP_PROPERTIES_CONFLICT', { currentRevision: 5 }); });
    const r = await saveTaskIntegrations(c, 'a', form([{ ...wire, readyLabel: '', excludeLabels: [] }]));
    expect(r).toMatchObject({ ok: false, code: 'APP_PROPERTIES_CONFLICT', currentRevision: 5 });
    expect(writes(c)).toHaveLength(1);
  });
  it('surfaces the path of TASK_INTEGRATION_INVALID', async () => {
    const c = client(current, () => { throw refusal('TASK_INTEGRATION_INVALID', { path: 'taskIntegrations[0].repositories[1]' }); });
    const r = await saveTaskIntegrations(c, 'a', form([{ ...wire, readyLabel: '', excludeLabels: [] }]));
    expect(r).toMatchObject({ ok: false, code: 'TASK_INTEGRATION_INVALID', path: 'taskIntegrations[0].repositories[1]' });
  });
  it('never sends a null lead: the write is refused in the portal, before any request', async () => {
    const c = client(current);
    const r = await saveTaskIntegrations(c, 'a', form([{ ...wire, teams: [{ lead: null, label: 'l' }], readyLabel: '', excludeLabels: [] }]));
    expect(r).toMatchObject({ ok: false, path: 'taskIntegrations[0].teams[0].lead' });
    expect(c.request).not.toHaveBeenCalled();
  });
  it('refuses a missing or malformed revision and malformed JSON without writing', async () => {
    for (const f of [form([], null), form([], 'x')]) {
      const c = client(current);
      expect(await saveTaskIntegrations(c, 'a', f)).toMatchObject({ ok: false });
      expect(writes(c)).toHaveLength(0);
    }
    const bad = new FormData(); bad.set('integrations', '{'); bad.set('revision', '1');
    expect(await saveTaskIntegrations(client(current), 'a', bad)).toMatchObject({ ok: false });
  });
  it('a crafted post with a malformed integration is refused, never a TypeError, and sends no request', async () => {
    const good = { ...wire, readyLabel: '', excludeLabels: [] };
    for (const bad of [[null], [42], [{ ...good, name: 5 }], [{ ...good, repositories: 'o/a' }], [{ ...good, provider: 'gitlab' }], [{ ...good, teams: [null] }], [{ ...good, teams: [{ lead: 3, label: 'l' }] }], [{ ...good, extra: null }], [{ ...good, excludeLabels: [1] }]]) {
      const c = client(current);
      expect(await saveTaskIntegrations(c, 'a', form(bad))).toMatchObject({ ok: false });
      expect(c.request).not.toHaveBeenCalled();
    }
  });
  it('P1: a blank() draft and a draft read from the stored entry each save with exactly one write', async () => {
    const stored = readIntegrations(current.properties).filter((e): e is IntegrationDraft => !isUnsupported(e));
    const blank = { ...blankIntegration(), name: 'fresh', repositories: ['o/new'] };
    for (const drafts of [stored, [...stored, blank]]) {
      const c = client(current);
      expect(await saveTaskIntegrations(c, 'a', form(drafts))).toEqual({ ok: true, revision: 4 });
      expect(writes(c)).toHaveLength(1);
    }
  });
  it('U7: a posted draft with an unknown key (extra), a non-constant provider or a malformed field is refused with the fixed error and no request', async () => {
    const good = { ...wire, readyLabel: '', excludeLabels: [] };
    for (const bad of [{ ...good, extra: {} }, { ...good, futureKey: 1 }, { ...good, provider: 'linear' }, { ...good, repositories: 5 }]) {
      const c = client(current);
      const r = await saveTaskIntegrations(c, 'a', form([bad]));
      expect(r).toMatchObject({ ok: false, message: 'The integrations could not be read. Reload the page and try again.' });
      expect(c.request).not.toHaveBeenCalled();
    }
  });
  it('U5b: the request carries the revision the person read, and a stale one is refused with nothing written', async () => {
    const c = client(current);
    await saveTaskIntegrations(c, 'a', form([{ ...wire, readyLabel: '', excludeLabels: [] }], '7'));
    expect(writes(c)[0][1].expectedRevision).toBe(7);
    const stale = client(current, () => { throw refusal('APP_PROPERTIES_CONFLICT', { currentRevision: 9 }); });
    const r = await saveTaskIntegrations(stale, 'a', form([{ ...wire, readyLabel: '', excludeLabels: [] }], '3'));
    expect(r).toMatchObject({ ok: false, code: 'APP_PROPERTIES_CONFLICT', currentRevision: 9 });
    expect(writes(stale)).toHaveLength(1);
  });
  it('does not write when the fresh read fails', async () => {
    const c = client(new Error('boom'));
    expect(await saveTaskIntegrations(c, 'a', form([]))).toMatchObject({ ok: false });
    expect(writes(c)).toHaveLength(0);
  });
});
