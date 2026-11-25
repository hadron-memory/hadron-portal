import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { aiConfigStrings } from '../src/lib/i18n/ai-config-strings';
const phone = readFileSync(new URL('./test-ai-config-phone.mjs', import.meta.url), 'utf8');
const rows = readFileSync(new URL('./test-ai-config-row-menu.mjs', import.meta.url), 'utf8');
describe('#1956 harness entrypoint preservation', () => {
  it('uses explicit readiness and named dismissal instead of network-idle or coordinate taps', () => {
    expect(phone).not.toContain('networkidle');
    expect(phone).not.toContain('touchscreen.tap(2, 2)');
  });
  // portal#1957 D2: a page error or console error on the phone/desktop pass failed nothing before. Source-text pin, like the rest of
  // this file: the script itself needs a full stack, so the wiring is what is held here.
  it('fails the run on a page or console error, as the cell-overflow harness does', () => {
    const at = (needle: string) => {
      const i = phone.indexOf(needle);
      expect(i, needle).toBeGreaterThanOrEqual(0);
      return i;
    };
    // On the context, so a second page is covered.
    at("context.on('weberror'");
    at("context.on('console'");
    expect(phone).toMatch(/msg\.type\(\) === 'error'/);
    at("context.route('**/favicon.ico'");
    // Asserted after the flow, and printed in finally so an early failure still shows the cause.
    const asserted = at('assert.deepEqual(errors, []');
    const closed = at('await context.close()');
    expect(asserted).toBeLessThan(closed);
    expect(phone.slice(asserted, closed)).toContain('console.error(');
  });
  it('creates the optional screenshots directory', () => {
    expect(phone).toMatch(/mkdir\(process\.env\.AI_CONFIG_TEST_SHOTS/);
  });
  it('uses independent pointer contexts for phone and desktop', () => {
    expect(phone).toContain('newContext');
    expect(phone).toContain("pointer: fine");
    expect(phone).toContain("pointer: coarse");
  });
  it('checks both scroll extremes before both actions through the shared helper', () => {
    expect(rows.match(/assertActionAtScrollEdges\(/g)).toHaveLength(2);
    expect(rows).toContain('ancestor::td[1]');
  });
  it('removes only the unrendered string, retaining named delete copy', () => {
    expect(aiConfigStrings).not.toHaveProperty('confirmQuestion');
    expect(aiConfigStrings.confirmDelete('synthetic')).toBe('Delete the “synthetic” configuration? This cannot be undone.');
  });
});
