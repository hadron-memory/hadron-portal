import { describe, it, expect } from 'vitest';
// @ts-expect-error plain .mjs helper shared with the layout script
import { parseHarnessEnv, injectionEcho } from './cell-harness-env.mjs';

// portal#2129 rows 1, 6, 8: every env knob is validated before any browser launches.
describe('parseHarnessEnv', () => {
  it('accepts an empty environment', () => {
    expect(parseHarnessEnv({})).toEqual({ cellWidth: null, cellKind: null, injectPointerFailure: false, injectMissingTrigger: false });
  });
  it.each(['1', '390', '1280', '99999'])('accepts CELL_WIDTH=%s', v => {
    expect(parseHarnessEnv({ CELL_WIDTH: v }).cellWidth).toBe(Number(v));
  });
  it.each(['', ' ', '0', '-1', 'abc', '390px', 'Infinity', '1e3', '3.5', '100000', '0390'])('rejects CELL_WIDTH=%j', v => {
    expect(() => parseHarnessEnv({ CELL_WIDTH: v })).toThrow(`CELL_WIDTH must be a whole number of pixels from 1 to 99999, got ${JSON.stringify(v)}`);
  });
  it.each(['alarms', 'runs', 'config', 'findings', 'agent-tasks'])('accepts CELL_KIND=%s', v => {
    expect(parseHarnessEnv({ CELL_KIND: v }).cellKind).toBe(v);
  });
  it.each(['', 'Findings', 'tasks'])('rejects CELL_KIND=%j', v => {
    expect(() => parseHarnessEnv({ CELL_KIND: v })).toThrow(`CELL_KIND must be alarms, runs, config, findings or agent-tasks, got ${JSON.stringify(v)}`);
  });
  describe.each(['CELL_INJECT_POINTER_FAILURE', 'CELL_INJECT_MISSING_TRIGGER'])('%s', name => {
    const key = name === 'CELL_INJECT_POINTER_FAILURE' ? 'injectPointerFailure' : 'injectMissingTrigger';
    it('is off when unset or 0, on when 1', () => {
      expect(parseHarnessEnv({})[key]).toBe(false);
      expect(parseHarnessEnv({ [name]: '0' })[key]).toBe(false);
      expect(parseHarnessEnv({ [name]: '1' })[key]).toBe(true);
    });
    it.each(['', '2', 'true', ' 1'])('rejects %j', v => {
      expect(() => parseHarnessEnv({ [name]: v })).toThrow(`${name} must be 0 or 1 when set, got ${JSON.stringify(v)}`);
    });
  });
});

describe('injection knobs and CELL_KIND', () => {
  it.each(['CELL_INJECT_POINTER_FAILURE', 'CELL_INJECT_MISSING_TRIGGER'])('%s=1 is rejected for a kind that never reaches the findings leg', name => {
    for (const kind of ['alarms', 'runs', 'config', 'agent-tasks']) {
      expect(() => parseHarnessEnv({ [name]: '1', CELL_KIND: kind })).toThrow(`${name}=1 only acts on the findings leg, got CELL_KIND=${JSON.stringify(kind)}`);
    }
  });
  it.each(['CELL_INJECT_POINTER_FAILURE', 'CELL_INJECT_MISSING_TRIGGER'])('%s=1 is accepted with CELL_KIND=findings or no kind, and 0 with any kind', name => {
    expect(() => parseHarnessEnv({ [name]: '1', CELL_KIND: 'findings' })).not.toThrow();
    expect(() => parseHarnessEnv({ [name]: '1' })).not.toThrow();
    expect(() => parseHarnessEnv({ [name]: '0', CELL_KIND: 'alarms' })).not.toThrow();
  });
});

describe('injectionEcho', () => {
  it('prints one line per knob set to exactly 1, nothing otherwise', () => {
    expect(injectionEcho(parseHarnessEnv({}))).toEqual([]);
    expect(injectionEcho(parseHarnessEnv({ CELL_INJECT_POINTER_FAILURE: '0', CELL_INJECT_MISSING_TRIGGER: '0' }))).toEqual([]);
    expect(injectionEcho(parseHarnessEnv({ CELL_INJECT_POINTER_FAILURE: '1' }))).toEqual(['INJECTION ACTIVE: CELL_INJECT_POINTER_FAILURE=1 (this run is expected to fail)']);
    expect(injectionEcho(parseHarnessEnv({ CELL_INJECT_POINTER_FAILURE: '1', CELL_INJECT_MISSING_TRIGGER: '1' }))).toHaveLength(2);
  });
});
