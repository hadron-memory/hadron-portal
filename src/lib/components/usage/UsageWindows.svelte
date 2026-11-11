<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { formatPortalDateTime } from '$lib/format-portal-date';
  import { percent, range, reasonText } from '$lib/usage-projection/present';
  import type { UsageWindow } from '$lib/usage-projection/types';
  let { windows }: { windows: UsageWindow[] } = $props();
  function windowName(w: UsageWindow) {
    return w.window === 'FIVE_HOUR' ? t('token-use.five-hour', '5-hour') : w.window === 'SEVEN_DAY' ? t('token-use.seven-day', '7-day') : t('token-use.other', '{minutes}-minute', { minutes: w.lengthMinutes });
  }
</script>
<div class="grid gap-3 md:grid-cols-2">
  {#each windows as w, i (`${w.window}:${w.lengthMinutes}:${i}`)}
    <div class="min-w-0 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" data-testid="usage-window">
      <h3 class="font-medium text-zinc-900 dark:text-white">{windowName(w)}</h3>
      {#if w.status !== 'PROJECTED'}
        <p class="mt-2 text-sm font-medium text-zinc-700 dark:text-zinc-200">{w.status === 'INSUFFICIENT_DATA' ? t('token-use.insufficient', 'Insufficient data') : t('token-use.unknown', 'Unknown')}</p>
        <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{reasonText(w.reason)}</p>
      {:else}
        <p class="mt-2 text-2xl font-semibold text-zinc-900 dark:text-white" data-testid="usage-range">{range(w.lowPctAtReset, w.highPctAtReset)}</p>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('token-use.at-reset', 'Projected use at reset')}</p>
        <dl class="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt class="text-zinc-500 dark:text-zinc-400">{t('token-use.used', 'Used now')}</dt><dd>{percent(w.usedPct)}</dd>
          <dt class="text-zinc-500 dark:text-zinc-400">{t('token-use.reset', 'Reset')}</dt><dd class="break-words">{formatPortalDateTime(w.resetsAt)}</dd>
          <dt class="text-zinc-500 dark:text-zinc-400">{t('token-use.ceiling', 'Ceiling')}</dt><dd>{percent(w.ceilingPct)}</dd>
          <dt class="text-zinc-500 dark:text-zinc-400">{t('token-use.confidence', 'Confidence')}</dt><dd>{w.confidence === 'HIGH' ? t('token-use.high', 'High') : w.confidence === 'MEDIUM' ? t('token-use.medium', 'Medium') : w.confidence === 'LOW' ? t('token-use.low', 'Low') : t('token-use.not-provided', 'Not provided')}</dd>
          <dt class="text-zinc-500 dark:text-zinc-400">{t('token-use.method', 'Method')}</dt><dd>{w.shape === 'WEEKLY' ? t('token-use.weekly', 'Weekly') : w.shape === 'FLAT' ? t('token-use.flat', 'Flat') : t('token-use.not-provided', 'Not provided')}</dd>
          <dt class="text-zinc-500 dark:text-zinc-400">{t('token-use.per-worker', 'Per-worker burn')}</dt><dd>{w.perWorkerBurn ? t('token-use.per-hour', '{range}/h', { range: range(w.perWorkerBurn.lowPctPerHour, w.perWorkerBurn.highPctPerHour) }) : t('token-use.not-provided', 'Not provided')}</dd>
          {#if w.runsOutAt}<dt class="text-zinc-500 dark:text-zinc-400">{t('token-use.run-out', 'Runs out')}</dt><dd class="break-words">{formatPortalDateTime(w.runsOutAt)}</dd>{/if}
        </dl>
      {/if}
    </div>
  {:else}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('token-use.no-windows', 'No windows reported for this account.')}</p>
  {/each}
</div>
