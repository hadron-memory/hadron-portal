<script lang="ts">
  import { t } from '$lib/i18n/t';

  interface FixtureSummary {
    id: string;
    loc: string;
    label: string;
    hasBaseline: boolean;
    capturedVerdict: 'pass' | 'fail' | null;
    capturedAt: string | null;
    assertionMode: 'literal-contains' | 'regex' | 'llm-judge' | null;
    updatedAt: string;
  }

  let {
    fixtures,
    running = false,
    onrunone,
    onrunall,
    ondelete,
  }: {
    fixtures: FixtureSummary[];
    running?: boolean;
    onrunone: (loc: string) => void;
    onrunall: () => void;
    ondelete: (loc: string) => void;
  } = $props();

  function modeLabel(mode: FixtureSummary['assertionMode']): string {
    if (mode === 'literal-contains') return t('agent-tester.assert.literal-contains', 'Literal contains');
    if (mode === 'regex') return t('agent-tester.assert.regex', 'Regex');
    if (mode === 'llm-judge') return t('agent-tester.assert.llm-judge', 'LLM-judge');
    return t('agent-tester.assert.mode-none', 'Probe only');
  }

  function verdictBadgeClass(v: FixtureSummary['capturedVerdict']): string {
    if (v === 'pass') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300';
    if (v === 'fail') return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
    return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  }
</script>

<section class="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
  <div class="mb-3 flex items-center justify-between">
    <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">
      {t('agent-tester.fixtures.heading', 'Saved fixtures')}
      <span class="ml-1 text-xs font-normal text-zinc-500">({fixtures.length})</span>
    </h2>
    <button
      type="button"
      onclick={onrunall}
      disabled={fixtures.length === 0 || running}
      class="rounded-md border border-indigo-300 px-3 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:border-zinc-300 disabled:text-zinc-400 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-950"
    >
      {running ? t('agent-tester.fixtures.running', 'Running…') : t('agent-tester.fixtures.run-all', 'Run all')}
    </button>
  </div>

  {#if fixtures.length === 0}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">
      {t('agent-tester.empty-fixture-list', 'No saved fixtures yet. Use "Save as fixture" after a successful probe to lock down expected behavior.')}
    </p>
  {:else}
    <ul class="divide-y divide-zinc-200 dark:divide-zinc-800">
      {#each fixtures as f (f.id)}
        <li class="flex items-center justify-between py-2 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate font-medium text-zinc-900 dark:text-zinc-100">{f.label}</span>
              <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide {verdictBadgeClass(f.capturedVerdict)}">
                {f.capturedVerdict ?? t('agent-tester.fixtures.unrun', 'unrun')}
              </span>
              <span class="text-xs text-zinc-500 dark:text-zinc-400">{modeLabel(f.assertionMode)}</span>
            </div>
            {#if f.capturedAt}
              <p class="mt-0.5 text-xs text-zinc-400">
                {t('agent-tester.fixtures.captured-at', 'Baseline')}: {new Date(f.capturedAt).toLocaleString()}
              </p>
            {/if}
          </div>
          <div class="ml-2 flex items-center gap-2">
            <button
              type="button"
              onclick={() => onrunone(f.loc)}
              disabled={running}
              class="rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            >
              {t('agent-tester.fixtures.run-one', 'Run')}
            </button>
            <button
              type="button"
              onclick={() => ondelete(f.loc)}
              disabled={running}
              class="rounded-md border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950"
            >
              {t('agent-tester.fixtures.delete', 'Delete')}
            </button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>
