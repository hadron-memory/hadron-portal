/**
 * #808 — DriftReport SSR render tests.
 *
 * These exist because of @codex's P2 on PR #812, and the gap it exposed is
 * worth stating: every test for the baseline refusal lived on the ENDPOINT, so
 * they all confirmed the server refuses the write. None of them could see that
 * the UI was still OFFERING it, because no test rendered the component.
 *
 * A refusal the user reaches by clicking a button that looks available is not
 * the same product as a control that is not there.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';

import DriftReport from './DriftReport.svelte';
import type { DriftVerdict, Verdict } from '$lib/agent-tester/verdict-types';

function result(over: {
  newVerdict: Verdict;
  driftVerdict: DriftVerdict;
  reply?: 'same' | 'different';
  baselineRefused?: string;
}) {
  return {
    fixtureLoc: 'fixtures:abc',
    newReply: 'Hi! Welcome.',
    newRoute: { conversationLoc: 'c', stageLoc: 's', personaName: null },
    newVerdict: over.newVerdict,
    newDetail: 'detail',
    drift: {
      reply: over.reply ?? 'different',
      route: 'different' as const,
      verdict: over.driftVerdict,
    },
    ...(over.baselineRefused ? { baselineRefused: over.baselineRefused } : {}),
  };
}

function body(over: Parameters<typeof result>[0]) {
  return render(DriftReport, {
    props: { results: [result(over)], onacceptbaseline: () => {} },
  }).body;
}

describe('DriftReport (#808)', () => {
  it('offers "Accept new baseline" for a real result', () => {
    const html = body({ newVerdict: 'fail', driftVerdict: 'newly-failing' });
    expect(html).toContain('Accept new baseline');
  });

  it('withholds it when the replay produced no verdict', () => {
    const html = body({ newVerdict: 'unevaluated', driftVerdict: 'unevaluated' });
    expect(html).not.toContain('Accept new baseline');
    expect(html).toContain('cannot be accepted as a baseline');
  });

  // THE @codex CASE. `computeDrift` returns `no-baseline` before it ever looks
  // at the verdict, so a fixture that has never been captured AND whose
  // assertion could not evaluate reports drift `no-baseline` while its
  // `newVerdict` is `unevaluated`. Both facts are true; the drift field can
  // only carry one. Gating this control on drift offered a write the endpoint
  // then refused.
  it('withholds it for an unevaluated run on a fixture with NO baseline', () => {
    const html = body({ newVerdict: 'unevaluated', driftVerdict: 'no-baseline' });
    expect(html).not.toContain('Accept new baseline');
    expect(html).toContain('cannot be accepted as a baseline');
  });

  it('still offers it for a no-baseline fixture that DID evaluate', () => {
    // The other direction: capturing a first baseline is the main reason this
    // button exists, so the fix must not take it away from the case it serves.
    const html = body({ newVerdict: 'pass', driftVerdict: 'no-baseline' });
    expect(html).toContain('Accept new baseline');
  });

  it('surfaces a refusal the server reported', () => {
    // Reachable even with the gate above: clicking "Accept" RE-RUNS the
    // fixture, so a run that evaluated when rendered can fail to evaluate on
    // the accepting run.
    const html = body({
      newVerdict: 'unevaluated',
      driftVerdict: 'unevaluated',
      baselineRefused: 'the assertion did not run, so there is no verdict to accept as a baseline',
    });
    expect(html).toContain('Baseline not updated');
    expect(html).toContain('there is no verdict to accept');
  });

  it('labels the unevaluated drift state without calling it a change', () => {
    const html = body({ newVerdict: 'unevaluated', driftVerdict: 'unevaluated' });
    expect(html).toContain('Not evaluated');
    expect(html).not.toContain('Newly failing');
  });
});
