<!--
  portal#1856 — one server count and what is behind it. The figure is `total`, never the
  number of ids; the ids are the server's (at most 200) and `truncated` says there are
  more, so a cut-short list is told as such and never implies completeness (hrn:node:hadronmemory.com:specs:cor:agt:150).
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { MetricsCount } from '$lib/team-metrics/types';

  let { count, kind, appId, label }: { count: MetricsCount; kind: 'task' | 'worker'; appId: string; label: string } = $props();

  const href = (id: string) => (kind === 'task' ? `/app/apps/${appId}/tasks/${id}` : `/app/workers/${id}`);
  const shown = $derived(count.ids.length);
  // `named` rides the same call as `ids`, in the same order (hadron-server#5029). An id with no readable
  // name (denied reads as missing) keeps the plain type + id chip; `ids` stays the list if `named` is absent.
  const chips = $derived(count.named?.length ? count.named : count.ids.map((id) => ({ id, name: null as string | null })));
</script>

{#if count.total === 0}
  <span class="tabular-nums text-zinc-500 dark:text-zinc-400" data-testid="metrics-count">0</span>
{:else}
  <details class="inline-block min-w-0 align-baseline" data-testid="metrics-drill">
    <summary class="cursor-pointer select-none rounded text-indigo-700 hover:underline focus-visible:outline-2 focus-visible:outline-indigo-500 dark:text-indigo-300" aria-label={t('team-metrics.drill.open', '{count} {label}, show them', { count: count.total, label })}>
      <span class="tabular-nums font-semibold" data-testid="metrics-count">{count.total}</span>
    </summary>
    <div class="mt-2 space-y-1 text-xs">
      {#if count.truncated}
        <p class="text-amber-800 dark:text-amber-300" data-testid="metrics-truncated">{t('team-metrics.drill.partial', 'First {shown} of {total}', { shown, total: count.total })}</p>
      {/if}
      <ul class="flex flex-wrap gap-1">
        {#each chips as chip (chip.id)}
          <li>
            <a href={href(chip.id)} class="block max-w-[16rem] rounded border border-zinc-200 px-1.5 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800" data-testid="metrics-chip">
              {#if chip.name}
                <span class="block truncate font-sans text-xs" title={chip.name} data-testid="metrics-chip-name">{chip.name}</span>
                <span class="block font-mono text-zinc-500 dark:text-zinc-400">{chip.id.slice(0, 8)}</span>
              {:else}
                <span class="font-mono"><span class="text-zinc-500 dark:text-zinc-400">{kind === 'task' ? t('team-metrics.drill.task', 'task') : t('team-metrics.drill.worker', 'worker')}</span> {chip.id.slice(0, 8)}</span>
              {/if}
            </a>
          </li>
        {/each}
      </ul>
    </div>
  </details>
{/if}
