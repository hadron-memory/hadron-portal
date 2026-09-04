<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { DriftVerdict, Verdict } from '$lib/agent-tester/verdict-types';

  interface RunResult {
    fixtureLoc: string;
    newReply: string;
    newRoute: { conversationLoc: string | null; stageLoc: string | null; personaName: string | null };
    newVerdict: Verdict;
    newDetail: string;
    drift: {
      reply: 'same' | 'different';
      route: 'same' | 'different';
      verdict: DriftVerdict;
    };
    /** #808: set when "Accept new baseline" was asked for and refused. */
    baselineRefused?: string;
  }

  // Per PR #217 review (high-3): a single fixture's error MUST NOT
  // abort the whole batch. The server now isolates each run and
  // returns one of these shapes per fixture.
  interface RunErrorResult { fixtureLoc: string; error: string }
  type Result = RunResult | RunErrorResult;

  let {
    results,
    onacceptbaseline,
  }: {
    results: Result[];
    onacceptbaseline?: (loc: string) => void;
  } = $props();

  function isError(r: Result): r is RunErrorResult {
    return 'error' in r;
  }

  function verdictLabel(v: RunResult['drift']['verdict']): string {
    switch (v) {
      case 'still-passing': return t('agent-tester.drift.still-passing', 'Still passing');
      case 'still-failing': return t('agent-tester.drift.still-failing', 'Still failing');
      case 'newly-passing': return t('agent-tester.drift.newly-passing', 'Newly passing');
      case 'newly-failing': return t('agent-tester.drift.newly-failing', 'Newly failing');
      case 'no-baseline':   return t('agent-tester.drift.no-baseline',   'No baseline');
      // #808: not a drift direction — the replay produced no verdict, so
      // whether it drifted is unknown. Worded as the absence it is, so it can't
      // be read as a fifth kind of change.
      case 'unevaluated':   return t('agent-tester.drift.unevaluated',   'Not evaluated');
    }
  }

  function verdictClass(v: RunResult['drift']['verdict']): string {
    switch (v) {
      case 'still-passing': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300';
      case 'still-failing': return 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300';
      case 'newly-passing': return 'bg-emerald-200 text-emerald-800 ring-1 ring-emerald-400 dark:bg-emerald-800 dark:text-emerald-100';
      case 'newly-failing': return 'bg-red-200 text-red-800 ring-1 ring-red-400 dark:bg-red-800 dark:text-red-100';
      case 'no-baseline':   return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
      case 'unevaluated':   return 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
    }
  }
</script>

<section class="rounded-md border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
  <h2 class="mb-3 text-sm font-semibold text-zinc-900 dark:text-white">
    {t('agent-tester.drift.heading', 'Drift report')}
  </h2>
  <ul class="space-y-3">
    {#each results as r (r.fixtureLoc)}
      <li class="rounded-md border p-3 {isError(r)
        ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950'
        : 'border-zinc-200 dark:border-zinc-800'}">
        {#if isError(r)}
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs text-zinc-500 dark:text-zinc-400">{r.fixtureLoc}</span>
            <span class="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-700 dark:text-amber-100">
              {t('agent-tester.drift.errored', 'Errored')}
            </span>
          </div>
          <p class="mt-2 text-xs text-amber-800 dark:text-amber-200">{r.error}</p>
          <p class="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">
            {t('agent-tester.drift.errored-note', 'Run continued with other fixtures. Retry this one individually.')}
          </p>
        {:else}
          <div class="flex items-center justify-between">
            <span class="font-mono text-xs text-zinc-500 dark:text-zinc-400">{r.fixtureLoc}</span>
            <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide {verdictClass(r.drift.verdict)}">
              {verdictLabel(r.drift.verdict)}
            </span>
          </div>
          <div class="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt class="text-zinc-500 dark:text-zinc-400">{t('agent-tester.drift.reply-label', 'Reply')}</dt>
            <dd class="text-zinc-900 dark:text-zinc-100">
              {r.drift.reply === 'different' ? t('agent-tester.drift.changed', '(changed)') : t('agent-tester.drift.unchanged', '(unchanged)')}
            </dd>
            <dt class="text-zinc-500 dark:text-zinc-400">{t('agent-tester.drift.route-label', 'Route')}</dt>
            <dd class="text-zinc-900 dark:text-zinc-100 font-mono">
              {r.newRoute.stageLoc ?? '—'}{r.drift.route === 'different' ? ' ' + t('agent-tester.drift.changed', '(changed)') : ''}
            </dd>
            <dt class="text-zinc-500 dark:text-zinc-400">{t('agent-tester.drift.detail-label', 'Detail')}</dt>
            <dd class="text-zinc-700 dark:text-zinc-300">{r.newDetail}</dd>
          </div>
          {#if r.drift.reply === 'different' || r.drift.verdict === 'newly-failing' || r.drift.verdict === 'newly-passing'}
            <details class="mt-2 text-xs">
              <summary class="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-300">
                {t('agent-tester.drift.show-reply', 'Show new reply')}
              </summary>
              <pre class="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-xs text-zinc-700 dark:bg-zinc-950 dark:text-zinc-300">{r.newReply}</pre>
            </details>
            <!-- #808: no "Accept new baseline" for a run that produced no
                 verdict. The reply above is real and worth reading, but there
                 is no result to accept, and the endpoint refuses the write —
                 offering the button would be offering a no-op. -->
            {#if onacceptbaseline && r.drift.verdict !== 'unevaluated'}
              <button
                type="button"
                onclick={() => onacceptbaseline?.(r.fixtureLoc)}
                class="mt-2 rounded-md border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                {t('agent-tester.drift.accept-baseline', 'Accept new baseline')}
              </button>
            {:else if onacceptbaseline}
              <p class="mt-2 text-[10px] text-zinc-500 dark:text-zinc-400">
                {t(
                  'agent-tester.drift.cannot-accept-baseline',
                  'This run produced no verdict, so it cannot be accepted as a baseline. Run the fixture again.',
                )}
              </p>
            {/if}
          {/if}
          {#if r.baselineRefused}
            <p class="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
              {t('agent-tester.drift.baseline-refused', 'Baseline not updated')}: {r.baselineRefused}
            </p>
          {/if}
        {/if}
      </li>
    {/each}
  </ul>
</section>
