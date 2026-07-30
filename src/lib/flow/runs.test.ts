import { describe, expect, it } from 'vitest';
import {
  defaultRunRecordUrn,
  describeTrigger,
  entryNodeLabel,
  failureCode,
  fmtRunTime,
  isCancellable,
  parseApiDate,
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
