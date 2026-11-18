import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain .mjs helper shared with the layout script and the native self-test
import { messages, NEEDLES } from './cell-harness-messages.mjs';
// @ts-expect-error plain .mjs helper
import { pointerVerdict } from './cell-harness-checks.mjs';

// portal#2131: the native self-test asserts some messages are ABSENT. An absence check over a copied string goes
// vacuously green when the script rewords the message, so the script and the test share one definition, and these
// pure tests prove each needle still matches the text the script emits.
describe('needles match what is emitted', () => {
  const leg = 'findings/390/light';
  it.each([
    ['severityFields', messages.severityFields(leg, 1)],
    ['wrapControlMissed', messages.wrapControlMissed(leg, ['plain'])],
    ['vertical', messages.verticalPrecondition(leg, 300)],
    ['vertical', messages.verticalNotDetected(leg)],
    ['vertical', messages.verticalLeftEscape(leg)],
  ])('needle %s is inside the emitted message', (key, text) => {
    expect(text).toContain(NEEDLES[key]);
    expect(text.startsWith(`${leg}: `)).toBe(true);
  });
  it('the pointer-regression needle is what pointerVerdict emits for a wrong baseline', () => {
    expect(pointerVerdict({ width: 390, actualCoarse: false, inject: false })[0]).toContain(NEEDLES.pointerRegression);
  });
  it('every needle is non-empty and distinct', () => {
    const values = Object.values(NEEDLES) as string[];
    expect(values.every(v => v.length > 0)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('the layout script emits these messages only through the shared builders', () => {
  const script = readFileSync(new URL('../test-table-cell-overflow-layout.mjs', import.meta.url), 'utf8');
  it('imports the module and calls every builder', () => {
    expect(script).toContain("from './lib/cell-harness-messages.mjs'");
    for (const name of ['severityFields', 'wrapControlMissed', 'verticalPrecondition', 'verticalNotDetected', 'verticalLeftEscape']) {
      expect(script, `builder ${name} is used`).toContain(`messages.${name}(`);
    }
  });
  it('holds no inline copy of a needle, so it cannot drift away from the shared text', () => {
    for (const key of ['severityFields', 'wrapControlMissed']) expect(script, `inline copy of ${key}`).not.toContain(NEEDLES[key]);
    expect(script).not.toMatch(/vertical (control|negative control)/);
  });
});
