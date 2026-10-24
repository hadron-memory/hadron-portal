/**
 * Hugo's #28704 — HADRON_TEST_MAX_WORKERS caps vitest's workers only when it
 * is a positive integer; otherwise vitest's default stands.
 */
import { describe, expect, it } from 'vitest';
import { testMaxWorkers } from './test-max-workers.mjs';

describe('testMaxWorkers', () => {
  it('takes a positive integer, trimmed', () => {
    expect(testMaxWorkers('1')).toBe(1);
    expect(testMaxWorkers(' 4 ')).toBe(4);
  });

  it('leaves the default when unset or empty, without a warning', () => {
    const warned: string[] = [];
    expect(testMaxWorkers(undefined, (m) => warned.push(m))).toBeUndefined();
    expect(testMaxWorkers('', (m) => warned.push(m))).toBeUndefined();
    expect(testMaxWorkers('  ', (m) => warned.push(m))).toBeUndefined();
    expect(warned).toEqual([]);
  });

  it.each(['0', '-2', '1.5', '2e1', 'four', '50%', '04', '99999999999999999999'])(
    'ignores %j and says so',
    (raw) => {
      const warned: string[] = [];
      expect(testMaxWorkers(raw, (m) => warned.push(m))).toBeUndefined();
      expect(warned).toHaveLength(1);
      expect(warned[0]).toContain('HADRON_TEST_MAX_WORKERS');
    },
  );
});
