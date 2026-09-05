/**
 * #813 — the fixture run summary, SSR.
 *
 * The endpoint always returned these tallies and nothing rendered them, so a
 * "Run all" produced a per-fixture list and no count of anything. #812 made the
 * gap sharper by adding `unevaluated`, the state that exists so a run which
 * could not be measured is NOT reported as a failure — correct in the response
 * and invisible on screen.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import RunSummary from './RunSummary.svelte';

type Summary = Parameters<typeof RunSummary>[1] extends never ? never : Record<string, unknown>;

function summary(over: Record<string, unknown> = {}) {
  return {
    totalRuns: 3,
    passed: 3,
    failed: 0,
    errored: 0,
    unevaluated: 0,
    estimatedCost: { currency: 'USD', amount: 0.06 },
    exceededCap: false,
    ...over,
  };
}

const body = (over: Record<string, unknown> = {}) =>
  render(RunSummary, { props: { summary: summary(over) as never } }).body;

describe('RunSummary (#813)', () => {
  it('shows the totals a run-all previously reported nowhere', () => {
    const html = body({ totalRuns: 12, passed: 9, failed: 3 });
    expect(html).toContain('12');
    expect(html).toContain('9');
    expect(html).toContain('passed');
    expect(html).toContain('failed');
  });

  it('reports the actual cost, which only the pre-flight dialog used to quote', () => {
    expect(body({ estimatedCost: { currency: 'USD', amount: 0.24 } })).toContain('USD 0.24');
  });

  it('counts unevaluated apart from failed, and says what it means', () => {
    // The #812 distinction: an unmeasured run is not a regression. Rendering it
    // in the failed tally would restate the exact claim #812 removed.
    const html = body({ totalRuns: 3, passed: 1, failed: 0, unevaluated: 2 });
    expect(html).toContain('not evaluated');
    expect(html).toMatch(/neither a pass nor a failure/i);
  });

  it('styles unevaluated and errored neutrally, never as failures', () => {
    const html = body({ passed: 0, failed: 0, unevaluated: 1, errored: 1 });
    // Red is a claim about the agent; neither of these states makes one.
    const tallies = html.match(/<span class="(rounded-full[^"]*)"[^>]*>([\s\S]*?)<\/span>/g) ?? [];
    const nonPassing = tallies.filter((s) => /not evaluated|errored/.test(s));
    expect(nonPassing).toHaveLength(2);
    for (const tally of nonPassing) {
      // Match COLOUR CLASSES, not a bare /red/ — which my first version did,
      // and which matches the substring inside the word "er-red-ored". The
      // assertion failed on correct markup.
      const classes = tally.match(/class="([^"]*)"/)?.[1] ?? '';
      expect(classes).not.toMatch(/(?:bg|text|border)-red-/);
    }
  });

  it('hides zero tallies but always shows passed', () => {
    // A clean run should read "12 passed", not a row of zeros — but "0 passed"
    // is information, so it is never hidden.
    const clean = body({ totalRuns: 12, passed: 12 });
    expect(clean).toContain('passed');
    expect(clean).not.toContain('errored');
    expect(clean).not.toContain('not evaluated');

    expect(body({ passed: 0, failed: 3 })).toContain('passed');
  });

  it('survives a server that does not send unevaluated', () => {
    // The field arrived in #812; a portal deployed against an older server must
    // not render "undefined not evaluated".
    const html = body({ unevaluated: undefined });
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('not evaluated');
  });

  it('says a capped run was confirmed rather than silently over budget', () => {
    expect(body({ exceededCap: true })).toMatch(/above the cost cap/i);
  });

  it('makes the fixture count agree with itself', () => {
    expect(body({ totalRuns: 1, passed: 1 })).toMatch(/\(1\s*fixture\)/);
    expect(body({ totalRuns: 2, passed: 2 })).toMatch(/\(2\s*fixtures\)/);
  });
});
