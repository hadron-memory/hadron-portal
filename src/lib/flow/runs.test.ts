import { describe, expect, it } from 'vitest';
import {
  defaultRunRecordUrn,
  describeTrigger,
  entryNodeLabel,
  failureCode,
  fmtRunTime,
  isCancellable,
  parseApiDate,
  parseHops,
  fmtHopTokens,
  fmtHopDuration,
  runDuration,
  visibleEnvelope,
} from './runs';

describe('parseApiDate', () => {
  it('parses epoch-millis strings (the spec-040 wire format) and ISO', () => {
    expect(parseApiDate('1783449600000')?.getTime()).toBe(1783449600000);
    expect(parseApiDate('2026-07-07T10:00:00.000Z')?.toISOString()).toBe('2026-07-07T10:00:00.000Z');
    expect(parseApiDate(null)).toBeNull();
    expect(parseApiDate('garbage')).toBeNull();
  });
});

describe('runDuration', () => {
  it('formats ms/s/min ranges and dashes incomplete runs', () => {
    expect(runDuration({ startedAt: '1000', finishedAt: '1500' })).toBe('500ms');
    expect(runDuration({ startedAt: '1000', finishedAt: '4000' })).toBe('3s');
    expect(runDuration({ startedAt: '0', finishedAt: '130000' })).toBe('2m 10s');
    expect(runDuration({ startedAt: '1000', finishedAt: null })).toBe('—');
  });
});

describe('trigger / failure / cancel helpers', () => {
  it('describes triggers with the schedule or webhook name when present', () => {
    expect(describeTrigger({ triggerKind: 'MANUAL', eventData: null })).toBe('Manual');
    expect(
      describeTrigger({ triggerKind: 'SCHEDULE', eventData: { scheduleName: 'morning-digest' } }),
    ).toBe('Schedule · morning-digest');
  });

  it('extracts the failure code', () => {
    expect(failureCode({ failure: { code: 'MAX_HOPS_EXCEEDED' } })).toBe('MAX_HOPS_EXCEEDED');
    expect(failureCode({ failure: null })).toBeNull();
  });

  it('only PENDING/RUNNING are cancellable', () => {
    expect(isCancellable('PENDING')).toBe(true);
    expect(isCancellable('RUNNING')).toBe(true);
    expect(isCancellable('COMPLETED')).toBe(false);
    expect(isCancellable('CANCELLED')).toBe(false);
  });
});

describe('defaultRunRecordUrn', () => {
  it('places runs:<id> beside the entry node', () => {
    expect(defaultRunRecordUrn({ id: 'r1', entryNodeUrn: 'acme.com::flows::classify' })).toBe(
      'acme.com::flows::runs:r1',
    );
    expect(defaultRunRecordUrn({ id: 'r1', entryNodeUrn: 'malformed' })).toBeNull();
  });
});

describe('visibleEnvelope', () => {
  it('hides runner plumbing keys', () => {
    expect(visibleEnvelope({ intent: 'x', __aiConfigName: 'default' })).toEqual({ intent: 'x' });
    expect(visibleEnvelope({ __only: 1 })).toBeNull();
    expect(visibleEnvelope(null)).toBeNull();
  });
});

describe('entryNodeLabel', () => {
  it('strips the memory prefix and passes a prefix-less urn through', () => {
    expect(entryNodeLabel('hrn:node:acme.com::flows::entry')).toBe('entry');
    expect(entryNodeLabel('flows:entry')).toBe('flows:entry');
  });
});

describe('fmtRunTime', () => {
  it('renders a pinned-locale datetime and dashes missing values', () => {
    expect(fmtRunTime(null)).toBe('—');
    expect(fmtRunTime('2026-07-07T10:00:00.000Z')).toMatch(/Jul/);
  });
});

describe('parseHops (#482)', () => {
  const hop = (over: Record<string, unknown> = {}) => ({
    node: 'hrn:node:acme.com:flows:classify',
    edgeOut: 'next',
    startedAt: 1790848800000,
    finishedAt: 1790848802500,
    tokensSpent: 120,
    ...over,
  });

  it('absent, non-array and malformed trails are unavailable, never invented as zero hops', () => {
    for (const raw of [null, undefined, {}, 'x', 7, [null], [1], [hop({ node: '' })], [hop({ node: 3 })], [hop({ tokensSpent: -1 })], [hop({ tokensSpent: 'many' })], [hop({ startedAt: 'nope' }), hop({ finishedAt: Number.NaN }), hop({ startedAt: -5 }), hop({ startedAt: Infinity })], [hop({ edgeOut: 4 })]]) {
      expect(parseHops(raw)).toEqual({ state: 'unavailable' });
    }
  });

  it('one malformed element makes the whole trail unavailable', () => {
    expect(parseHops([hop(), hop({ node: null })])).toEqual({ state: 'unavailable' });
  });

  it('an empty array is a real, empty trail (distinct from unavailable)', () => {
    expect(parseHops([])).toEqual({ state: 'ready', hops: [] });
  });

  it('keeps completed hops in order, edgeOut belongs to the row it is on, tokens null is unknown and 0 is real', () => {
    const r = parseHops([hop({ tokensSpent: null }), hop({ node: 'hrn:node:acme.com:flows:reply', edgeOut: null, tokensSpent: 0 })]);
    expect(r.state).toBe('ready');
    if (r.state !== 'ready') throw new Error('unreachable');
    expect(r.hops.map((h) => h.node)).toEqual(['hrn:node:acme.com:flows:classify', 'hrn:node:acme.com:flows:reply']);
    expect(r.hops[0].edgeOut).toBe('next');
    expect(r.hops[1].edgeOut).toBeNull();
    expect(r.hops[0].tokensSpent).toBeNull();
    expect(r.hops[1].tokensSpent).toBe(0);
  });

  it('accepts the producer wire shape: epoch-millisecond numbers (hadron-server appRuns.ts), normalised to ISO; ISO strings too', () => {
    const r = parseHops([hop(), hop({ startedAt: '2026-10-01T10:00:00.000Z', finishedAt: '2026-10-01T10:00:02.000Z' })]);
    expect(r.state).toBe('ready');
    if (r.state !== 'ready') throw new Error('unreachable');
    expect(r.hops[0].startedAt).toBe('2026-10-01T10:00:00.000Z');
    expect(fmtHopDuration(r.hops[0].startedAt, r.hops[0].finishedAt)).toBe('3s');
    expect(r.hops[1].startedAt).toBe('2026-10-01T10:00:00.000Z');
  });

  it('formats unknown tokens and durations as unknown, zero as 0', () => {
    expect(fmtHopTokens(null)).toBe('—');
    expect(fmtHopTokens(0)).toBe('0');
    expect(fmtHopTokens(1234)).toBe('1,234');
    expect(fmtHopDuration('2026-10-01T10:00:00.000Z', '2026-10-01T10:00:02.500Z')).toBe('3s');
    expect(fmtHopDuration('2026-10-01T10:00:00.000Z', null)).toBe('—');
    expect(fmtHopDuration('2026-10-01T10:00:05.000Z', '2026-10-01T10:00:00.000Z')).toBe('—');
  });
});
