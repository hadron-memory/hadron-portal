import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { FINDINGS_SEVERITIES } from './findings-severity-triggers';

// portal#2129 row 5: adversarial synthetic labels, pinned byte for byte. They are NOT the real severity set
// (P1/P2/P3/note, hrn:node:hadronmemory.com:specs:cor:agt:050:30) and must never be narrowed to it or merged with it.
describe('FINDINGS_SEVERITIES', () => {
  it('pins the six-marker label by code point', () => {
    expect([...FINDINGS_SEVERITIES.markers].map(c => c.codePointAt(0)!.toString(16))).toEqual(
      ['73', '65', '76', '2d', '41', '2061', '42', '2062', '43', '2063', '44', '2064', '45', '2028', '46', '2029', '47']);
  });
  it('pins the plain label to 80 S', () => {
    expect(FINDINGS_SEVERITIES.plain).toBe('S'.repeat(80));
  });
  it('imports no component or harness, so a unit test pulls no fixture-mount code', () => {
    const src = readFileSync(new URL('./findings-severity-triggers.ts', import.meta.url), 'utf8');
    const specifiers = [...src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)].map(m => m[1]);
    expect(specifiers).toEqual([]);
  });
});
