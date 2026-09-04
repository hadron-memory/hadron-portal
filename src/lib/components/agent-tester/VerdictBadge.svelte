<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { Verdict } from '$lib/agent-tester/verdict-types';

  interface AssertionResult {
    mode: 'literal-contains' | 'regex' | 'llm-judge';
    verdict: Verdict;
    detail: string;
    judgeScore?: number | null;
    judgeRationale?: string;
  }

  let { assertion }: { assertion: AssertionResult } = $props();

  // #808: three states, and the old `passed ? green : red` is why this needed a
  // shape change rather than a message change. Red is a claim about the agent's
  // reply; an assertion that never ran has made no such claim, so it renders
  // neutral — the same visual weight as "no answer", which is what it is.
  //
  // A switch and NOT a ternary chain, deliberately. A ternary's final `else`
  // silently adopts any member added to `Verdict` later — the exact defect this
  // component is being fixed for, one level up. With no `default` and a return
  // type that excludes undefined, a fourth verdict makes this fail to compile
  // and forces a decision about which tone it gets. Verified by adding one.
  type Tone = 'pass' | 'fail' | 'unevaluated';
  function toneOf(v: Verdict): Tone {
    switch (v) {
      case 'pass': return 'pass';
      case 'fail': return 'fail';
      case 'unevaluated': return 'unevaluated';
    }
  }
  const tone = $derived(toneOf(assertion.verdict));

  const containerClass = $derived(
    tone === 'pass'
      ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950'
      : tone === 'fail'
        ? 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950'
        : 'border-zinc-300 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900',
  );

  const badgeClass = $derived(
    tone === 'pass'
      ? 'bg-emerald-600 text-white'
      : tone === 'fail'
        ? 'bg-red-600 text-white'
        : 'bg-zinc-500 text-white',
  );

  const badgeLabel = $derived(
    tone === 'pass'
      ? t('agent-tester.verdict.pass', 'Pass')
      : tone === 'fail'
        ? t('agent-tester.verdict.fail', 'Fail')
        : t('agent-tester.verdict.unevaluated', 'Not evaluated'),
  );
</script>

<div class="rounded-md border p-3 text-sm {containerClass}">
  <div class="flex items-center gap-2">
    <span class="rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide {badgeClass}">
      {badgeLabel}
    </span>
    <span class="text-xs text-zinc-500 dark:text-zinc-400">
      {#if assertion.mode === 'literal-contains'}{t('agent-tester.assert.literal-contains', 'Literal contains')}{/if}
      {#if assertion.mode === 'regex'}{t('agent-tester.assert.regex', 'Regex')}{/if}
      {#if assertion.mode === 'llm-judge'}{t('agent-tester.assert.llm-judge', 'LLM-judge')}{/if}
    </span>
  </div>
  <p class="mt-2 text-zinc-700 dark:text-zinc-300">{assertion.detail}</p>
  {#if tone === 'unevaluated'}
    <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
      {t(
        'agent-tester.verdict.unevaluated-note',
        'The assertion did not run, so this says nothing about the reply above — it is neither a pass nor a fail.',
      )}
    </p>
  {/if}
  {#if assertion.mode === 'llm-judge' && assertion.judgeRationale}
    <details class="mt-2 text-xs">
      <summary class="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
        {t('agent-tester.verdict.judge-rationale', 'Judge rationale')}
      </summary>
      <p class="mt-1 text-zinc-600 dark:text-zinc-400">{assertion.judgeRationale}</p>
    </details>
  {/if}
</div>
