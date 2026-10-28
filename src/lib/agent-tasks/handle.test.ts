import { describe, expect, it } from 'vitest';
import { isProjectZero, parseHandle, resolveSegment, taskHref } from './handle';

const APP = 'hrn:app:hadronmemory.com:hadron-dev-team';
const Q = (a: string, h: string) => `hrn:agenttask:${a}:${h}`;

describe('parseHandle', () => {
  it.each(['AT0', 'AT3', 'AT3.405', 'at3.405', 'AT3.405.16'])('%s is a handle', (s) => {
    expect(parseHandle(s)?.handle).toBe(s.toUpperCase());
  });
  it.each(['', 'AT', 'AT01', 'AT3.0', 'AT3.', 'AT3..4', ' AT3', 'AT3 ', 'T3', '3', 'a1b2c3d4', 'AT3.405x',
    'AT99999999999999999999', 'AT' + '1.'.repeat(40) + '1'])('%j is not', (s) => {
    expect(parseHandle(s)).toBeNull();
  });
  it('a 16-deep handle is one, a 17-deep is not', () => {
    expect(parseHandle('AT1' + '.1'.repeat(15))).not.toBeNull();
    expect(parseHandle('AT1' + '.1'.repeat(16))).toBeNull();
  });
  it('a segment past bigint is not one', () => {
    expect(parseHandle('AT3.9223372036854775808')).toBeNull();
    expect(parseHandle('AT3.9223372036854775807')).not.toBeNull();
  });
  it('a qualified spelling carries its App', () => {
    expect(parseHandle(Q('hadronmemory.com:other', 'AT3.4'))).toEqual({ handle: 'AT3.4', appUrn: 'hadronmemory.com:other' });
  });
});

describe('resolveSegment', () => {
  it('a raw id is forwarded unchanged', () => {
    expect(resolveSegment('01a183bf0909786da0956d67ca469650', APP)).toEqual({ kind: 'ref', ref: '01a183bf0909786da0956d67ca469650' });
  });
  it('a bare handle is qualified with the ROUTE App, canonical case', () => {
    expect(resolveSegment('at3.405', APP)).toEqual({ kind: 'ref', ref: Q('hadronmemory.com:hadron-dev-team', 'AT3.405') });
  });
  it('a qualified handle of this App is forwarded', () => {
    expect(resolveSegment(Q('hadronmemory.com:hadron-dev-team', 'AT3'), APP)).toEqual({
      kind: 'ref',
      ref: Q('hadronmemory.com:hadron-dev-team', 'AT3'),
    });
  });
  it('a qualified handle of ANOTHER App is unknown, never forwarded', () => {
    expect(resolveSegment(Q('hadronmemory.com:other-app', 'AT3'), APP)).toEqual({ kind: 'unknown' });
    expect(resolveSegment(Q('other.com:hadron-dev-team', 'AT3'), APP)).toEqual({ kind: 'unknown' });
  });
  it('an App URN the portal cannot read as an App makes a handle unknown, not an id', () => {
    expect(resolveSegment('AT3', 'not-a-urn')).toEqual({ kind: 'unknown' });
  });
});

describe('taskHref', () => {
  it('prefers the handle and encodes the segment', () => {
    expect(taskHref('/app/apps/a1', { id: 'abc', handle: 'AT3.405' })).toBe('/app/apps/a1/tasks/AT3.405');
  });
  it('falls back to the id when there is no handle', () => {
    expect(taskHref('/app/apps/a1', { id: 'abc', handle: null })).toBe('/app/apps/a1/tasks/abc');
    expect(taskHref('/app/apps/a1', { id: 'abc' })).toBe('/app/apps/a1/tasks/abc');
  });
});

describe('isProjectZero', () => {
  it('is exactly AT0', () => {
    expect(isProjectZero('AT0')).toBe(true);
    for (const h of ['AT01', 'AT0.1', 'AT3', '', null, undefined]) expect(isProjectZero(h as string)).toBe(false);
  });
});
