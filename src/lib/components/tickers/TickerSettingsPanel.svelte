<!--
  portal#1099 — the App's ticker settings, READ-ONLY (design §3.4; editing is
  S7b, not in v1). Everyone who can see the page reads them, because the
  limits explain the server's refusals. Who can change them is said in words
  rather than offered as a control the portal can't gate (server ask 3,
  hadron-server#1927 item 9).
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { cadenceText } from '$lib/tickers/format';
  import type { AppTickerSettings, TickerRead } from '$lib/tickers/types';

  let { settings }: { settings: TickerRead<AppTickerSettings> } = $props();
</script>

<section aria-labelledby="ticker-settings-heading" class="space-y-2" data-testid="ticker-settings">
  <h2 id="ticker-settings-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tickers.settings.heading', 'Settings')}</h2>
  {#if settings.kind === 'ok'}
    {@const s = settings.value}
    <dl class="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 text-sm sm:grid-cols-2 dark:border-zinc-800 dark:bg-zinc-900">
      <div class="min-w-0">
        <dt class="font-medium text-zinc-900 dark:text-white">{t('app.tickers.settings.floor', 'Fastest ticker: every {every}', { every: cadenceText(s.minCadenceSeconds) })}</dt>
        <dd class="text-zinc-600 dark:text-zinc-400">{t('app.tickers.settings.floor.help', 'No ticker may be faster, and no worker is woken more often than this, managers’ mentions included.')}</dd>
      </div>
      <div class="min-w-0">
        <dt class="font-medium text-zinc-900 dark:text-white">{t('app.tickers.settings.self', 'Workers may subscribe themselves to tickers every {every} or slower', { every: cadenceText(s.selfSubscribeCadenceSeconds) })}</dt>
        <dd class="text-zinc-600 dark:text-zinc-400">{t('app.tickers.settings.self.help', 'Faster tickers need the worker’s holder or whoever manages the App.')}</dd>
      </div>
      <div class="min-w-0">
        <dt class="font-medium text-zinc-900 dark:text-white">{t('app.tickers.settings.cap', 'Up to {n} tickers', { n: s.liveCap })}</dt>
      </div>
      <div class="min-w-0">
        <dt class="font-medium text-zinc-900 dark:text-white">
          {t('app.tickers.settings.budget', '{n} ticker wakes a day', { n: s.dailyWakeBudget })}
          {#if s.dailyWakeBudgetDerived}<span class="font-normal text-zinc-500 dark:text-zinc-400">{t('app.tickers.settings.budget.derived', '(set automatically from the team’s size)')}</span>{/if}
        </dt>
        <dd class="text-zinc-600 dark:text-zinc-400">{t('app.tickers.settings.budget.help', 'Mentions from managers don’t count. When it runs out, wakes wait until the next UTC day, and the team chat gets one notice.')}</dd>
      </div>
    </dl>
    <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tickers.settings.who', 'Only whoever manages the App can change these settings.')}</p>
  {:else if settings.kind === 'failed'}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {t('app.tickers.settings.failed', 'Couldn’t load this App’s ticker settings.')}
    </div>
  {/if}
</section>
