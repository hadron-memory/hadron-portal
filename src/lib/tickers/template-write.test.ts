/**
 * portal#1609 (Agent ticker templates, slice C of #1141) — what the template
 * forms send. Create is an explicit set; an edit sends only what the reader
 * changed; a revision always rides along from what the page READ; and quiet
 * hours are removed with clearQuietHours, never with null.
 */
import { describe, expect, it } from 'vitest';
import { buildTemplateCreateInput, buildTemplateDelete, buildTemplateUpdate } from './template-write';

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

const stored = {
  id: 'tpl-1',
  expectedRevision: '4',
  nameWas: 'standup',
  cadenceSecondsWas: '600',
  reasonsShown: '1',
  reasonsWas: 'READ_TEAM_CHANNEL',
};
const unchanged = { ...stored, name: 'standup', cadenceSeconds: '600', reasons: ['READ_TEAM_CHANNEL'] };

describe('buildTemplateCreateInput', () => {
  it('sends an explicit reasons array and only name, cadence and reasons', () => {
    const r = buildTemplateCreateInput(fd({ name: ' standup ', cadenceSeconds: '600', reasons: ['READ_TEAM_CHANNEL', 'LIVE_CHECK'], quietHours: '{}', enabled: 'true' }));
    expect(r).toEqual({ input: { name: 'standup', cadenceSeconds: 600, reasons: ['READ_TEAM_CHANNEL', 'LIVE_CHECK'] } });
  });

  it('an empty reasons set is refused on the reasons field: [] is never sent', () => {
    expect(buildTemplateCreateInput(fd({ name: 'a', cadenceSeconds: '60' }))).toMatchObject({ invalid: { field: 'reasons' } });
  });

  it('a blank name and a non-whole cadence are refused on their own fields', () => {
    expect(buildTemplateCreateInput(fd({ name: '  ', cadenceSeconds: '60', reasons: ['EVERY_TICK'] }))).toMatchObject({ invalid: { field: 'name' } });
    for (const bad of ['', '1.5', '-3', 'abc', '99999999999']) {
      expect(buildTemplateCreateInput(fd({ name: 'a', cadenceSeconds: bad, reasons: ['EVERY_TICK'] }))).toMatchObject({ invalid: { field: 'cadenceSeconds' } });
    }
  });

  it('does no client-side cadence range check: the template has no App floor (cor:agt:080:33)', () => {
    expect(buildTemplateCreateInput(fd({ name: 'a', cadenceSeconds: '1', reasons: ['EVERY_TICK'] }))).toMatchObject({ input: { cadenceSeconds: 1 } });
    expect(buildTemplateCreateInput(fd({ name: 'a', cadenceSeconds: '9999999', reasons: ['EVERY_TICK'] }))).toMatchObject({ input: { cadenceSeconds: 9999999 } });
  });
});

describe('buildTemplateUpdate', () => {
  it('sends only the changed fields, plus the revision the page read', () => {
    expect(buildTemplateUpdate(fd({ ...unchanged, name: 'daily' }))).toEqual({ id: 'tpl-1', expectedRevision: 4, patch: { name: 'daily' } });
    expect(buildTemplateUpdate(fd({ ...unchanged, cadenceSeconds: '900' }))).toEqual({ id: 'tpl-1', expectedRevision: 4, patch: { cadenceSeconds: 900 } });
    expect(buildTemplateUpdate(fd({ ...unchanged, reasons: ['READ_TEAM_CHANNEL', 'EVERY_TICK'] }))).toEqual({
      id: 'tpl-1',
      expectedRevision: 4,
      patch: { reasons: ['READ_TEAM_CHANNEL', 'EVERY_TICK'] },
    });
  });

  it('no change is no write', () => {
    expect(buildTemplateUpdate(fd(unchanged))).toMatchObject({ invalid: { field: 'form' } });
  });

  it('a revision that is missing or not a whole number sends nothing', () => {
    for (const bad of ['', '-1', '1.5', 'x']) {
      expect(buildTemplateUpdate(fd({ ...unchanged, name: 'daily', expectedRevision: bad }))).toMatchObject({ invalid: { field: 'form' } });
    }
    const f = fd({ ...unchanged, name: 'daily' });
    f.delete('expectedRevision');
    expect(buildTemplateUpdate(f)).toMatchObject({ invalid: { field: 'form' } });
  });

  it('a missing template id sends nothing', () => {
    const f = fd({ ...unchanged, name: 'daily' });
    f.delete('id');
    expect(buildTemplateUpdate(f)).toMatchObject({ invalid: { field: 'form' } });
  });

  it('emptying the reasons is refused and [] is never sent', () => {
    const f = fd({ ...unchanged, name: 'daily' });
    f.delete('reasons');
    expect(buildTemplateUpdate(f)).toMatchObject({ invalid: { field: 'reasons' } });
  });

  it('a template whose reasons the form did not show keeps them: no reasons key', () => {
    const r = buildTemplateUpdate(fd({ ...unchanged, reasonsShown: '0', reasons: [], name: 'daily' }));
    expect(r).toEqual({ id: 'tpl-1', expectedRevision: 4, patch: { name: 'daily' } });
  });

  it('removing quiet hours sends clearQuietHours: true, never null and never quietHours', () => {
    const r = buildTemplateUpdate(fd({ ...unchanged, clearQuietHours: '1' }));
    expect(r).toEqual({ id: 'tpl-1', expectedRevision: 4, patch: { clearQuietHours: true } });
    expect(JSON.stringify(r)).not.toContain('null');
    expect(JSON.stringify(r)).not.toContain('"quietHours"');
  });

  it('an unticked clear box sends no clearQuietHours (false is not sent either)', () => {
    const r = buildTemplateUpdate(fd({ ...unchanged, name: 'daily' })) as { patch: object };
    expect('clearQuietHours' in r.patch).toBe(false);
  });

  it('a blank name or non-whole cadence is refused on its own field', () => {
    expect(buildTemplateUpdate(fd({ ...unchanged, name: ' ' }))).toMatchObject({ invalid: { field: 'name' } });
    expect(buildTemplateUpdate(fd({ ...unchanged, cadenceSeconds: '1.5' }))).toMatchObject({ invalid: { field: 'cadenceSeconds' } });
  });
});

describe('buildTemplateDelete', () => {
  it('names the template and the revision the page read', () => {
    expect(buildTemplateDelete(fd({ id: 'tpl-1', expectedRevision: '4' }))).toEqual({ id: 'tpl-1', expectedRevision: 4 });
  });

  it('refuses a missing id or an unusable revision, sending nothing', () => {
    expect(buildTemplateDelete(fd({ expectedRevision: '4' }))).toMatchObject({ invalid: { field: 'form' } });
    expect(buildTemplateDelete(fd({ id: 'tpl-1' }))).toMatchObject({ invalid: { field: 'form' } });
    expect(buildTemplateDelete(fd({ id: 'tpl-1', expectedRevision: '4.5' }))).toMatchObject({ invalid: { field: 'form' } });
  });
});
