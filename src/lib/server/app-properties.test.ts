/**
 * portal#1607 — the App properties read and the task-integrations write
 * (setAppProperties, hrn:node:hadronmemory.com:specs:cor:dmo:050:20): whole replace with expectedRevision,
 * a conflict is reported and never retried, a path-bearing refusal is surfaced.
 */
import { describe, expect, it, vi } from 'vitest';
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
    const r = await saveTaskIntegrations(c, 'a', form([{ ...wire, name: 'renamed', extra: {}, readyLabel: '', excludeLabels: [], teams: wire.teams }]));
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
    const r = await saveTaskIntegrations(c, 'a', form([{ ...wire, extra: {}, readyLabel: '', excludeLabels: [] }]));
    expect(r).toMatchObject({ ok: false, code: 'APP_PROPERTIES_CONFLICT', currentRevision: 5 });
    expect(writes(c)).toHaveLength(1);
  });
  it('surfaces the path of TASK_INTEGRATION_INVALID', async () => {
    const c = client(current, () => { throw refusal('TASK_INTEGRATION_INVALID', { path: 'taskIntegrations[0].repositories[1]' }); });
    const r = await saveTaskIntegrations(c, 'a', form([{ ...wire, extra: {}, readyLabel: '', excludeLabels: [] }]));
    expect(r).toMatchObject({ ok: false, code: 'TASK_INTEGRATION_INVALID', path: 'taskIntegrations[0].repositories[1]' });
  });
  it('never sends a null lead: the write is refused in the portal, before any request', async () => {
    const c = client(current);
    const r = await saveTaskIntegrations(c, 'a', form([{ ...wire, teams: [{ lead: null, label: 'l' }], extra: {}, readyLabel: '', excludeLabels: [] }]));
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
  it('does not write when the fresh read fails', async () => {
    const c = client(new Error('boom'));
    expect(await saveTaskIntegrations(c, 'a', form([]))).toMatchObject({ ok: false });
    expect(writes(c)).toHaveLength(0);
  });
});
