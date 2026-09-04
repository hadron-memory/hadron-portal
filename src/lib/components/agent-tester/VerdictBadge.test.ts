/**
 * #808 — VerdictBadge SSR render tests.
 *
 * The verdict widened from two states to three, and the reason it needed a
 * shape change rather than a message change lives entirely in this component:
 * it rendered `passed ? green : red`, so every non-pass was styled as a claim
 * that the agent's reply was wrong. These pin that the third state is neither.
 *
 * SSR-only, per `hrn:node:hadronmemory.com:hadron-portal:conventions:svelte-component-test-gap`
 * — nothing here depends on the lifecycle, only on what the markup asserts to
 * a reader.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import VerdictBadge from './VerdictBadge.svelte';

function body(verdict: 'pass' | 'fail' | 'unevaluated', detail = 'some detail') {
  return render(VerdictBadge, {
    props: { assertion: { mode: 'regex' as const, verdict, detail } },
  }).body;
}

describe('VerdictBadge (#808)', () => {
  it('pass renders the success treatment', () => {
    const html = body('pass');
    expect(html).toContain('Pass');
    expect(html).toMatch(/emerald/);
    expect(html).not.toMatch(/\bbg-red-600\b/);
  });

  it('fail renders the failure treatment — a claim about the reply', () => {
    const html = body('fail');
    expect(html).toContain('Fail');
    expect(html).toMatch(/\bbg-red-600\b/);
  });

  it('unevaluated renders neutral: neither the green nor the red treatment', () => {
    const html = body('unevaluated');
    // Red is the specific defect. Before #808 this state did not exist and its
    // causes all arrived here as `fail`, so the user read a red badge and
    // concluded their agent had regressed.
    expect(html).not.toMatch(/\bbg-red-600\b/);
    expect(html).not.toMatch(/emerald/);
    expect(html).not.toContain('>Fail<');
    expect(html).not.toContain('>Pass<');
  });

  it('unevaluated says what it means, so the neutral colour is not the only signal', () => {
    // Colour alone is not an accessible signal, and "Not evaluated" on its own
    // still leaves a reader wondering what it says about the reply. The note
    // answers exactly that, and answers it by withholding.
    const html = body('unevaluated');
    expect(html).toContain('Not evaluated');
    expect(html).toContain('did not run');
    expect(html).toMatch(/neither a pass nor a fail/);
  });

  it('the detail is rendered in every state — it is what names the cause', () => {
    for (const v of ['pass', 'fail', 'unevaluated'] as const) {
      expect(body(v, 'regex could not be evaluated — the worker did not return a result'))
        .toContain('regex could not be evaluated');
    }
  });
});
