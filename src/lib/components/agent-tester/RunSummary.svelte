<!--
  #813 — the fixture run's tallies.

  The endpoint has always returned a `summary` block and nothing rendered it, so
  after a "Run all" across a dozen fixtures the reader got a per-fixture list and
  no count of anything: not how many passed, not how many errored, and not the
  cost the pre-flight cap was computed from.

  #812 made that gap sharper by adding `unevaluated` — the state that exists
  precisely so a run which could not be measured is NOT reported as a failure.
  That distinction was correct in the response and invisible on screen.

  Counts are neutral-styled unless they are a real verdict: `unevaluated` and
  `errored` are grey, because neither says anything about the agent
  (`hrn:node:hadronmemory.com:hadron-portal:review:a-fallback-asserts-what-it-was-written-for`
  — a red tally would make the same claim the red badge used to).
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  interface Summary {
    totalRuns: number;
    passed: number;
    failed: number;
    errored: number;
    /** #812. Optional: a server older than that change omits it. */
    unevaluated?: number;
    estimatedCost: { currency: string; amount: number };
    exceededCap: boolean;
  }

  let { summary }: { summary: Summary } = $props();

  // A tally is shown when it is non-zero, so a clean run reads "12 passed"
  // rather than a row of zeros. `passed` is always shown — it is the one number
  // a reader looks for, and "0 passed" is information, not noise.
  const tallies = $derived(
    [
      {
        key: 'passed',
        value: summary.passed,
        label: t('agent-tester.summary.passed', 'passed'),
        always: true,
        class: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
      },
      {
        key: 'failed',
        value: summary.failed,
        label: t('agent-tester.summary.failed', 'failed'),
        always: false,
        class: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
      },
      {
        key: 'unevaluated',
        value: summary.unevaluated ?? 0,
        label: t('agent-tester.summary.unevaluated', 'not evaluated'),
        always: false,
        class: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
      },
      {
        key: 'errored',
        value: summary.errored,
        label: t('agent-tester.summary.errored', 'errored'),
        always: false,
        class: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400',
      },
    ].filter((tally) => tally.always || tally.value > 0),
  );

  // Two decimals, and the currency as the server names it — the pre-flight
  // dialog quotes the same shape, so the number the user accepted and the number
  // they are charged for read identically.
  const cost = $derived(
    `${summary.estimatedCost.currency} ${summary.estimatedCost.amount.toFixed(2)}`,
  );
</script>

<section
  class="rounded-md border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900"
  aria-label={t('agent-tester.summary.aria', 'Fixture run summary')}
>
  <div class="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
    <span class="font-semibold text-zinc-900 dark:text-white">
      {t('agent-tester.summary.heading', 'Run')}
      <span class="font-normal text-zinc-500">
        ({summary.totalRuns}
        {summary.totalRuns === 1
          ? t('agent-tester.summary.fixture', 'fixture')
          : t('agent-tester.summary.fixtures', 'fixtures')})
      </span>
    </span>

    {#each tallies as tally (tally.key)}
      <span class="rounded-full px-2 py-0.5 font-medium {tally.class}">
        {tally.value}
        {tally.label}
      </span>
    {/each}

    <span class="ml-auto text-zinc-500 dark:text-zinc-400">
      {t('agent-tester.summary.cost', 'Est. cost')}: {cost}
    </span>
  </div>

  {#if (summary.unevaluated ?? 0) > 0}
    <p class="mt-2 text-[11px] text-zinc-500 dark:text-zinc-400">
      {t(
        'agent-tester.summary.unevaluated-note',
        'A fixture that could not be evaluated was not measured against your agent — it is neither a pass nor a failure.',
      )}
    </p>
  {/if}

  {#if summary.exceededCap}
    <p class="mt-2 text-[11px] text-amber-700 dark:text-amber-300">
      {t(
        'agent-tester.summary.cap-note',
        'This run was above the cost cap and ran because you confirmed it.',
      )}
    </p>
  {/if}
</section>
