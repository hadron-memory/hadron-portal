/**
 * Spec 019 T017 — Hand-curated LLM-judge eval fixture set.
 *
 * Triples of (reply, criterion, expectedVerdict). Used by an integration
 * test (not yet wired — see the placeholder test below) to assert the
 * judge agrees with `expectedVerdict` on ≥ 80% of the set per release-
 * gating build. Per Constitution Principle I: LLM-driven code requires
 * an eval; this is that eval.
 *
 * Each fixture documents *why* the expected verdict is correct in a
 * one-line comment so future reviewers can recalibrate the set when a
 * judge model drifts.
 */

export interface JudgeEvalFixture {
  id: string;
  reply: string;
  criterion: string;
  /** Verdict given a threshold of 0.7 (the default the Tester suggests). */
  expectedVerdict: 'pass' | 'fail';
  note: string;
}

export const JUDGE_EVAL_FIXTURES: JudgeEvalFixture[] = [
  {
    id: 'welcome-pass',
    reply: 'Hello! Welcome to the assistant. What can I help you with today?',
    criterion: 'The reply welcomes the user and offers to help.',
    expectedVerdict: 'pass',
    note: 'Textbook welcome + offer-to-help — unambiguously satisfies.',
  },
  {
    id: 'welcome-fail-curt',
    reply: 'Yes?',
    criterion: 'The reply welcomes the user and offers to help.',
    expectedVerdict: 'fail',
    note: 'Curt one-word reply; no welcome, no help offer.',
  },
  {
    id: 'refusal-pass',
    reply: 'I can\'t help with that. Is there something else I can assist with?',
    criterion: 'The reply refuses the request politely and offers an alternative.',
    expectedVerdict: 'pass',
    note: 'Polite refusal + alternative — squarely on-target.',
  },
  {
    id: 'refusal-fail-rude',
    reply: 'No, I won\'t do that.',
    criterion: 'The reply refuses the request politely and offers an alternative.',
    expectedVerdict: 'fail',
    note: 'Refusal present but no politeness softener, no alternative.',
  },
  {
    id: 'extraction-pass',
    reply: 'Got it — I\'ll remember your name is Alex.',
    criterion: 'The reply confirms the user\'s name was captured.',
    expectedVerdict: 'pass',
    note: 'Explicit confirmation by name.',
  },
  {
    id: 'extraction-fail',
    reply: 'Thanks for sharing!',
    criterion: 'The reply confirms the user\'s name was captured.',
    expectedVerdict: 'fail',
    note: 'Generic acknowledgement; no name confirmation.',
  },
  {
    id: 'topic-pass',
    reply: 'Photosynthesis is the process plants use to convert sunlight into chemical energy stored as glucose.',
    criterion: 'The reply explains photosynthesis at a high school level.',
    expectedVerdict: 'pass',
    note: 'Accurate and grade-appropriate.',
  },
  {
    id: 'topic-fail-irrelevant',
    reply: 'I love how the weather has been lately.',
    criterion: 'The reply explains photosynthesis at a high school level.',
    expectedVerdict: 'fail',
    note: 'Off-topic; doesn\'t address the criterion at all.',
  },
  {
    id: 'tone-pass',
    reply: 'I hear you — that sounds frustrating. Let me see what I can do.',
    criterion: 'The reply acknowledges the user\'s frustration with empathy.',
    expectedVerdict: 'pass',
    note: 'Active acknowledgement + empathy marker.',
  },
  {
    id: 'tone-fail-dismissive',
    reply: 'That\'s not really my problem. Anything else?',
    criterion: 'The reply acknowledges the user\'s frustration with empathy.',
    expectedVerdict: 'fail',
    note: 'Dismissive tone, opposite of empathy.',
  },
];
