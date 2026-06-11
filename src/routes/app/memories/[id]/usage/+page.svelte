<script lang="ts">
  // #266 Usage tab — per-memory usage events, rendered with the shared grid.
  import UsageEventsTable from '$lib/components/table/UsageEventsTable.svelte';
  import type { UsageEvent } from '$lib/components/table/usageEvent';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const g = $derived(data.graph);
</script>

<svelte:head><title>{g.name} &middot; Usage &middot; Hadron</title></svelte:head>

<section>
  <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">{t('usage.heading', 'Usage events')}</h2>
  <UsageEventsTable events={data.events as UsageEvent[]} listKey="memory:{g.id}:usage" />
</section>
