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
  const emitted: Array<[needle: string, message: string, text: string]> = [
    ['severityFields', 'severityFields', messages.severityFields(leg, 1)],
    ['wrapControlMissed', 'wrapControlMissed', messages.wrapControlMissed(leg, ['plain'])],
    ['vertical', 'verticalPrecondition', messages.verticalPrecondition(leg, 300)],
    ['vertical', 'verticalNotDetected', messages.verticalNotDetected(leg)],
    ['vertical', 'verticalLeftEscape', messages.verticalLeftEscape(leg)],
  ];
  // The message name is in the title: three rows share the vertical needle and must not collapse into duplicate titles (#2169).
  it.each(emitted)('needle %s is inside the emitted message %s', (key, _message, text) => {
    expect(text).toContain(NEEDLES[key]);
    expect(text.startsWith(`${leg}: `)).toBe(true);
  });
  it('a needle matches only the messages of its own key (#2169)', () => {
    const pointer = (pointerVerdict({ width: 390, actualCoarse: false, inject: false }) as string[])[0];
    const all = [...emitted.map(([key, , text]) => [key, text]), ['pointerRegression', pointer]] as Array<[string, string]>;
    for (const [needleKey, needle] of Object.entries(NEEDLES) as Array<[string, string]>) {
      for (const [ownerKey, text] of all) {
        expect(text.includes(needle), `needle ${needleKey} vs a ${ownerKey} message`).toBe(needleKey === ownerKey);
      }
    }
  });
  it('a needle is a phrase, not a bare word that other output could contain by accident (#2169)', () => {
    for (const [key, value] of Object.entries(NEEDLES) as Array<[string, string]>) expect(value, `needle ${key}`).toMatch(/[\s-]/);
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

// Formatting-sensitive by design (#2169): this block scans the script's SOURCE TEXT for quoted strings and call
// shapes, so a reformat (quote style, line wrapping) can trip it. That is the intended tripwire against an inline
// copy of a needle creeping back in; update the expectation with the reformat, never delete the guard.
describe('the layout script emits these messages only through the shared builders', () => {
  const script = readFileSync(new URL('../test-table-cell-overflow-layout.mjs', import.meta.url), 'utf8');
  it('imports the module and calls every builder', () => {
    expect(script).toContain("from './lib/cell-harness-messages.mjs'");
    for (const name of ['severityFields', 'wrapControlMissed', 'verticalPrecondition', 'verticalNotDetected', 'verticalLeftEscape']) {
      expect(script, `builder ${name} is used`).toContain(`messages.${name}(`);
    }
  });
  it('holds no inline copy of a needle, so it cannot drift away from the shared text', () => {
    for (const [key, needle] of Object.entries(NEEDLES) as Array<[string, string]>) expect(script, `inline copy of ${key}`).not.toContain(needle);
  });
});
