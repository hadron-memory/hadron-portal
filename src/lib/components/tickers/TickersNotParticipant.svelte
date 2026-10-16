<!--
  portal#1099 — what a ticker read's APP_NOT_FOUND means on a page whose App
  the viewer can see (design §7): they don't take part in it. An inline state,
  as on Tasks (#1052 §8), so the header and the page around it stay.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';

  let { impersonating = null, what = 'tickers' }: { impersonating?: string | null; what?: 'tickers' | 'wake' } = $props();
</script>

<div role="status" class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900" data-testid="tickers-not-participant">
  <p class="font-medium text-zinc-900 dark:text-white">
    {what === 'wake'
      ? t('worker.wake.not-participant.title', 'You don’t take part in this worker’s App, so its wake-ups aren’t shown.')
      : t('app.tickers.not-participant.title', 'You don’t take part in this App, so its tickers aren’t shown.')}
  </p>
  <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
    {t('app.tickers.not-participant.body', 'Tickers and wake-ups are visible to the App’s owner and members. If you should see them, ask the App’s owner to add you.')}
  </p>
  {#if impersonating}
    <p class="mt-2 text-sm text-amber-700 dark:text-amber-300">
      {t('app.tickers.not-participant.impersonating', 'You’re viewing as {user}, who doesn’t take part.', { user: impersonating })}
    </p>
  {/if}
</div>
