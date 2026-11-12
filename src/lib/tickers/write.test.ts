/**
 * portal#1151 (Tickers S7b) — what the create and edit forms send. The form
 * always sends an explicit reasons set on create; an edit sends only what the
 * reader changed, so an omitted `reasons` leaves them as they are.
 */
import { describe, expect, it } from 'vitest';
import { buildCreateInput, buildUpdatePatch } from './write';

function fd(fields: Record<string, string | string[]>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
}

describe('buildCreateInput', () => {
  it('sends an explicit reasons array, never leaning on the server default', () => {
    const r = buildCreateInput(fd({ name: ' standup ', cadenceSeconds: '600', reasons: ['READ_TEAM_CHANNEL'] }));
    expect(r).toEqual({ input: { name: 'standup', cadenceSeconds: 600, reasons: ['READ_TEAM_CHANNEL'] } });
  });

  it('sends several reasons as chosen', () => {
    const r = buildCreateInput(fd({ name: 'a', cadenceSeconds: '60', reasons: ['READ_TEAM_CHANNEL', 'LIVE_CHECK'] }));
    expect(r).toMatchObject({ input: { reasons: ['READ_TEAM_CHANNEL', 'LIVE_CHECK'] } });
  });

  it('an empty reasons set is refused on the reasons field and sends nothing', () => {
    expect(buildCreateInput(fd({ name: 'a', cadenceSeconds: '60' }))).toMatchObject({ invalid: { field: 'reasons' } });
  });

  it('a blank name and a non-whole cadence are refused on their own fields', () => {
    expect(buildCreateInput(fd({ name: '  ', cadenceSeconds: '60', reasons: ['EVERY_TICK'] }))).toMatchObject({ invalid: { field: 'name' } });
    for (const bad of ['', '1.5', '-3', 'abc', '99999999999']) {
      expect(buildCreateInput(fd({ name: 'a', cadenceSeconds: bad, reasons: ['EVERY_TICK'] }))).toMatchObject({ invalid: { field: 'cadenceSeconds' } });
    }
  });

  it('never sends enabled, channels, quiet hours or relevance', () => {
    const r = buildCreateInput(fd({ name: 'a', cadenceSeconds: '60', reasons: ['EVERY_TICK'], enabled: 'true' })) as { input: object };
    expect(Object.keys(r.input).sort()).toEqual(['cadenceSeconds', 'name', 'reasons']);
  });

  it('a value that is not a reason this build knows is dropped, not forwarded', () => {
    const r = buildCreateInput(fd({ name: 'a', cadenceSeconds: '60', reasons: ['EVERY_TICK', 'NOT_A_REASON'] }));
    expect(r).toMatchObject({ input: { reasons: ['EVERY_TICK'] } });
  });
});

describe('buildUpdatePatch', () => {
  const was = { nameWas: 'standup', cadenceSecondsWas: '600', reasonsWas: 'READ_TEAM_CHANNEL', reasonsShown: '1' };
  const same = { name: 'standup', cadenceSeconds: '600', reasons: ['READ_TEAM_CHANNEL'] };

  it('sends only the changed field, and omits reasons when they did not change', () => {
    expect(buildUpdatePatch(fd({ ...was, ...same, cadenceSeconds: '300' }))).toEqual({ patch: { cadenceSeconds: 300 } });
    expect(buildUpdatePatch(fd({ ...was, ...same, name: 'daily' }))).toEqual({ patch: { name: 'daily' } });
  });

  it('adding a reason sends the whole explicit set', () => {
    const r = buildUpdatePatch(fd({ ...was, ...same, reasons: ['READ_TEAM_CHANNEL', 'EVERY_TICK'] }));
    expect(r).toEqual({ patch: { reasons: ['READ_TEAM_CHANNEL', 'EVERY_TICK'] } });
  });

  it('removing a reason sends the smaller set', () => {
    const r = buildUpdatePatch(fd({ ...was, reasonsWas: 'EVERY_TICK,READ_TEAM_CHANNEL', ...same, reasons: ['READ_TEAM_CHANNEL'] }));
    expect(r).toEqual({ patch: { reasons: ['READ_TEAM_CHANNEL'] } });
  });

  it('clearing every reason is refused on the reasons field and sends nothing', () => {
    expect(buildUpdatePatch(fd({ ...was, name: 'standup', cadenceSeconds: '600' }))).toMatchObject({ invalid: { field: 'reasons' } });
  });

  it('a form that did not show the reasons never sends them', () => {
    const r = buildUpdatePatch(fd({ nameWas: 'a', cadenceSecondsWas: '60', name: 'b', cadenceSeconds: '60' }));
    expect(r).toEqual({ patch: { name: 'b' } });
  });

  it('nothing changed is refused on the form, and a bad cadence on its field', () => {
    expect(buildUpdatePatch(fd({ ...was, ...same }))).toMatchObject({ invalid: { field: 'form' } });
    expect(buildUpdatePatch(fd({ ...was, ...same, cadenceSeconds: 'x' }))).toMatchObject({ invalid: { field: 'cadenceSeconds' } });
  });

  it('never sends enabled', () => {
    const r = buildUpdatePatch(fd({ ...was, ...same, name: 'b', enabled: 'false' })) as { patch: object };
    expect(r.patch).not.toHaveProperty('enabled');
  });
});
