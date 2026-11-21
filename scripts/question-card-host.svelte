<!--
  portal#2440 — the browser harness's single-mount host for QuestionCard.
  The card is mounted ONCE for the whole run; scenarios swap props through
  $state (setProps below). That is what lets the layout script hold an element
  across a prop change and prove the live regions announce IN PLACE — a
  {#key result} or {#if result} refactor would recreate the region element and
  fail the script's identity check. The scenario data and the result building
  live in the fixture entry (test-question-card-layout.mjs), not here: this
  file is deliberately dumb.

  The trade-off (deliberate): every scenario after the first is an in-place
  prop update, so the card's internal state (an opened <details>, the posting
  flag) carries across scenarios, and the initial-render path runs exactly
  once, at startup. The non-live-region scenarios accept that: what they pin
  is markup and roles, which every prop swap re-derives.
-->
<script lang="ts">
  import QuestionCard from '../src/lib/components/questions/QuestionCard.svelte';
  import type { QuestionCardView } from '../src/lib/questions/types';
  import type { QuestionFormResult } from '../src/lib/questions/action-kinds';

  // Named `current`, not `state`: a local named `state` beside the $state rune
  // reads as a store subscription and trips store_rune_conflict.
  const current = $state<{ question: QuestionCardView | null; canAct: boolean; result: QuestionFormResult | null }>({
    question: null,
    canAct: true,
    result: null,
  });

  /** Swap the card's props on the one mounted instance; returns nothing (the entry awaits tick). */
  export function setProps(question: QuestionCardView, canAct: boolean, result: QuestionFormResult | null): void {
    current.question = question;
    current.canAct = canAct;
    current.result = result;
  }
</script>

{#if current.question}
  <QuestionCard question={current.question} canAct={current.canAct} result={current.result} />
{/if}
