import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chromium } from 'playwright';

// portal#2129 rows 1, 6, 7, 8: the layout script's own failure paths, run for real in Chromium.
// Without a browser (CI images that skip the browser legs) this is skipped with a visible reason; LOCAL runs it natively.
const haveChromium = (() => { try { return existsSync(chromium.executablePath()); } catch { return false; } })();
const run = (env: Record<string, string>) => {
  const r = spawnSync('node', ['scripts/test-table-cell-overflow-layout.mjs'], { env: { ...process.env, CELL_KIND: 'findings', CELL_WIDTH: '390', ...env }, encoding: 'utf8', timeout: 240_000 });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const count = (text: string, needle: string) => text.split(needle).length - 1;
// The failure list is printed twice by assert.deepEqual (diff and actual); the `+` diff lines are one per queued failure.
const queued = (text: string, message: string) => text.split('\n').filter(l => /^\+\s+'findings\/390\/(light|dark): /.test(l) && l.includes(message)).length;
const SUCCESS = 'severity and text inside their cells';
const INJECTED = 'pointer mode does not match the emulated device (injected)';

describe.skipIf(!haveChromium)('layout script failure paths (native)', { timeout: 300_000 }, () => {
  it('passes on a correct run and prints no injection echo', () => {
    const { code, out } = run({});
    expect(code).toBe(0);
    expect(count(out, SUCCESS)).toBe(2);
    expect(out).not.toContain('INJECTION ACTIVE');
  });
  it('CELL_INJECT_POINTER_FAILURE=1: one injected line per leg, no success line, exit non-zero, echoed once', () => {
    const { code, out } = run({ CELL_INJECT_POINTER_FAILURE: '1' });
    expect(code).not.toBe(0);
    expect(queued(out, INJECTED)).toBe(2);
    expect(queued(out, 'pointer baseline regression')).toBe(0);
    expect(count(out, SUCCESS)).toBe(0);
    expect(count(out, 'INJECTION ACTIVE: CELL_INJECT_POINTER_FAILURE=1')).toBe(1);
  });
  it('CELL_INJECT_MISSING_TRIGGER=1: one failure per leg, no cascade, exit non-zero', () => {
    const { code, out } = run({ CELL_INJECT_MISSING_TRIGGER: '1' });
    expect(code).not.toBe(0);
    expect(queued(out, 'expected 2 severity fields, found 1')).toBe(2);
    expect(count(out, 'FAILED, 1 check(s) queued')).toBe(2);
    expect(queued(out, 'negative control')).toBe(0);
    expect(queued(out, 'vertical')).toBe(0);
    expect(count(out, SUCCESS)).toBe(0);
  });
  it('a knob set to 0 is silent and the run passes', () => {
    const { code, out } = run({ CELL_INJECT_POINTER_FAILURE: '0', CELL_INJECT_MISSING_TRIGGER: '0' });
    expect(code).toBe(0);
    expect(out).not.toContain('INJECTION ACTIVE');
  });
});

// Row 1: a bad value fails before any browser launches. With no browsers installed, a launch would say so;
// the validation message must be what comes out instead.
describe('env validation happens before launch', () => {
  it.each(['', 'abc', '390px'])('CELL_WIDTH=%j exits non-zero with the validation line and no launch error', v => {
    const r = spawnSync('node', ['scripts/test-table-cell-overflow-layout.mjs'], { env: { ...process.env, CELL_WIDTH: v, PLAYWRIGHT_BROWSERS_PATH: '/nonexistent-browsers' }, encoding: 'utf8', timeout: 60_000 });
    const out = `${r.stdout}${r.stderr}`;
    expect(r.status).not.toBe(0);
    expect(out).toContain(`CELL_WIDTH must be a whole number of pixels from 1 to 99999, got ${JSON.stringify(v)}`);
    expect(out).not.toContain("Executable doesn't exist");
  });
});
