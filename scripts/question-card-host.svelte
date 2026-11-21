<!--
  portal#2440 — the browser harness's single-mount host for QuestionCard.
  The card is mounted ONCE for the whole run; scenarios swap props through
  $state (setProps below). That is what lets the layout script hold an element
  across a prop change and prove the live regions announce IN PLACE — a
  {#key result} or {#if result} refactor would recreate the region element and
  fail the script's identity check. The scenario data and the result building
  live in the fixture entry (test-question-card-layout.mjs), not here: this
  file is deliberately dumb.
-->
<script lang="ts">
  import QuestionCard from '../src/lib/components/questions/QuestionCard.svelte';
  import type { QuestionCardView } from '../src/lib/questions/types';
  import type { QuestionFormResult } from '../src/lib/questions/action-kinds';

  const state = $state<{ question: QuestionCardView | null; canAct: boolean; result: QuestionFormResult | null }>({
    question: null,
    canAct: true,
    result: null,
  });

  /** Swap the card's props on the one mounted instance; returns nothing (the entry awaits tick). */
  export function setProps(question: QuestionCardView, canAct: boolean, result: QuestionFormResult | null): void {
    state.question = question;
    state.canAct = canAct;
    state.result = result;
  }
</script>

{#if state.question}
  <QuestionCard question={state.question} canAct={state.canAct} result={state.result} />
{/if}
