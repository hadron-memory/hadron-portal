<script lang="ts">
  // #636: the first dashboard widget — how many memories the user has, plus a
  // "Create new" action. Consolidates the old hand-rolled count + "New memory"
  // stat cards into a single widget.
  import { t } from '$lib/i18n/t';
  import WidgetCard from '../WidgetCard.svelte';

  // The grid passes this widget's slice of the combined `dashboardWidgetData`
  // payload (memory-stats => { memoryCount }). Optional at the type level
  // (server JSON), so default it. The grid handles pending/failed streamed data before
  // mounting this widget, so a read failure never becomes a zero count.
  let { memoryCount = 0 }: { memoryCount?: number } = $props();
</script>

<WidgetCard title={t('dashboard.widget.memory-stats.title', 'Memory Stats')}>
  <p class="text-3xl font-bold tabular-nums text-zinc-900 dark:text-white">{memoryCount}</p>
  <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
    {memoryCount === 1
      ? t('dashboard.widget.memory-stats.count-one', 'memory')
      : t('dashboard.widget.memory-stats.count', 'memories')}
  </p>
  <a
    href="/app/memories/new"
    class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
  >
    {t('dashboard.widget.memory-stats.create', 'Create new')}
  </a>
</WidgetCard>
