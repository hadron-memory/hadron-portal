<script lang="ts">
  import { t } from '$lib/i18n/t';

  interface AssertionResult {
    mode: 'literal-contains' | 'regex' | 'llm-judge';
    verdict: 'pass' | 'fail';
    detail: string;
    judgeScore?: number | null;
    judgeRationale?: string;
  }

  let { assertion }: { assertion: AssertionResult } = $props();
  const passed = $derived(assertion.verdict === 'pass');
</script>

<div
  class="rounded-md border p-3 text-sm {passed
    ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-950'
    : 'border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950'}"
>
  <div class="flex items-center gap-2">
    <span
      class="rounded px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide {passed
        ? 'bg-emerald-600 text-white'
        : 'bg-red-600 text-white'}"
    >
      {passed ? t('agent-tester.verdict.pass', 'Pass') : t('agent-tester.verdict.fail', 'Fail')}
    </span>
    <span class="text-xs text-zinc-500 dark:text-zinc-400">
      {#if assertion.mode === 'literal-contains'}{t('agent-tester.assert.literal-contains', 'Literal contains')}{/if}
      {#if assertion.mode === 'regex'}{t('agent-tester.assert.regex', 'Regex')}{/if}
      {#if assertion.mode === 'llm-judge'}{t('agent-tester.assert.llm-judge', 'LLM-judge')}{/if}
    </span>
  </div>
  <p class="mt-2 text-zinc-700 dark:text-zinc-300">{assertion.detail}</p>
  {#if assertion.mode === 'llm-judge' && assertion.judgeRationale}
    <details class="mt-2 text-xs">
      <summary class="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
        {t('agent-tester.verdict.judge-rationale', 'Judge rationale')}
      </summary>
      <p class="mt-1 text-zinc-600 dark:text-zinc-400">{assertion.judgeRationale}</p>
    </details>
  {/if}
</div>
