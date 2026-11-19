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
