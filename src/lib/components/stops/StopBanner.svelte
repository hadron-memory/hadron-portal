<!--
  portal#1139 — the stops in effect, prominent on the App page and the stops
  page. Lists every live stop and states no precedence and no "effective"
  winner (R69). A partial read says "at least N"; a failed read says it could
  not check, never that there is nothing.
-->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { t } from '$lib/i18n/t';
  import { bannerCount, fmtStopTime, levelLabel, scopeLabel, targetOf } from '$lib/stop-signals/present';
  import type { LiveStops, StopRead, WorkerOption } from '$lib/stop-signals/types';

  let {
    live,
    workers = [],
    href = null,
  }: { live?: StopRead<LiveStops> | null; workers?: WorkerOption[]; href?: string | null } = $props();
</script>

<LiveRegion>
{#if !live}
  <!-- no read at all: nothing to say -->
{:else if live.kind === 'failed'}
  <div class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="stop-banner-unknown">
    {t('app.stops.banner.unknown', 'Couldn’t check whether any stops are in effect.')}
    {#if href}<a {href} class="ml-1 font-medium underline">{t('app.stops.banner.link', 'Open stops')}</a>{/if}
  </div>
{:else if live.kind === 'ok' && live.value.signals.length > 0}
  <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200" data-testid="stop-banner">
    <p class="font-semibold"><span aria-hidden="true">⛔</span> {bannerCount(live.value)}{#if href}<a {href} class="ml-2 text-sm font-medium underline">{t('app.stops.banner.link', 'Open stops')}</a>{/if}</p>
    <ul class="mt-1 list-inside list-disc">
      {#each live.value.signals as s (s.id)}
        {@const target = targetOf(s, workers)}
        <li>{levelLabel(s.level)} · {scopeLabel(s.scope)}{#if target}{' · '}{target.name ?? target.id}{/if}{#if s.until}{' · '}{t('app.stops.until', 'until {time}', { time: fmtStopTime(s.until) })}{/if}</li>
      {/each}
    </ul>
  </div>
{/if}
</LiveRegion>
