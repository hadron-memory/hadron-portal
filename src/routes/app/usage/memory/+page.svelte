<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import UsageEventsTable from '$lib/components/table/UsageEventsTable.svelte';
  import type { UsageEvent } from '$lib/components/table/usageEvent';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Memory Usage · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: 'Dashboard', href: '/app/dashboard' },
    { label: 'Memory Usage' },
  ]} />
  <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">Memory Usage</h1>

  <UsageEventsTable events={data.events as UsageEvent[]} listKey="usage:memory" />
</div>
