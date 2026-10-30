/**
 * portal#1139 — the banner never says "none" from a read it could not finish:
 * a partial read is "at least N", a failed read is "couldn't check", and every
 * live stop is listed with no precedence among them (R69).
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import StopBanner from './StopBanner.svelte';

const sig = (id: string, level: string, worker: string) => ({ id, level, scope: 'WORKER', targetWorkerId: worker, until: null, live: true });
const html = (live: unknown) => render(StopBanner, { props: { live, workers: [{ id: 'w1', name: 'Gaby', urn: null }], href: '/app/apps/a/stops' } as never }).body;

describe('StopBanner', () => {
  it('lists every live stop and names no winner', () => {
    const out = html({ kind: 'ok', value: { complete: true, signals: [sig('1', 'PAUSE', 'w1'), sig('2', 'HALT', 'w9')] } });
    expect(out).toContain('2 stops are in effect');
    expect(out).toContain('Pause');
    expect(out).toContain('Halt');
    expect(out).toContain('Gaby');
    expect(out).toContain('w9'); // an id the roster doesn't know is shown bare
    expect(out).not.toMatch(/effective|overrides|takes precedence/i);
  });

  it('a partial read says at least N, never an exact count', () => {
    const out = html({ kind: 'ok', value: { complete: false, signals: [sig('1', 'PAUSE', 'w1')] } });
    expect(out).toContain('At least 1 stop is in effect');
  });

  it('a failed read says it could not check, not that there are none', () => {
    const out = html({ kind: 'failed' });
    expect(out).toContain('Couldn’t check whether any stops are in effect');
  });

  it('an empty complete read, a non-participant and no read at all render nothing', () => {
    for (const live of [{ kind: 'ok', value: { complete: true, signals: [] } }, { kind: 'not-participant' }, undefined]) {
      expect(html(live)).not.toContain('stop');
    }
  });

  it('B3: a stop with an end time names its zone, in the confirm dialog\'s format', () => {
    const until = '2026-10-01T10:00:00Z';
    const out = html({ kind: 'ok', value: { complete: true, signals: [{ ...sig('1', 'PAUSE', 'w1'), until }] } });
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(out).toContain(`(${zone})`);
  });

  it('portal#1431: the until segment keeps the space before its dot', () => {
    const until = '2026-10-01T10:00:00Z';
    const out = html({ kind: 'ok', value: { complete: true, signals: [{ ...sig('1', 'PAUSE', 'w1'), until }] } });
    expect(out).toMatch(/\S · until /);
  });
});
