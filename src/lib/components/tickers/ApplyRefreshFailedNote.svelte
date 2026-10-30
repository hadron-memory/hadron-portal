<!--
  portal#1462 (Xavier's ruling A, #51237) — rendered inside the error boundaries that can catch a worker page's
  failed refresh. The panel that applied the tickers is gone by now, so this says what is true: the apply was
  committed, the page could not reload, reloading shows the list, and nothing is applied again from here.

  Shown once, and only to the viewer and worker whose marker is live (see $lib/tickers/refresh-marker). It reads
  storage after mount, so a server render and a hydration agree on nothing shown.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { applyRefreshFailedLine } from '$lib/tickers/apply';
  import { takeRefreshMarker } from '$lib/tickers/refresh-marker';

  let shown = $state(false);
  onMount(() => {
    const viewer = ($page.data as { user?: { id?: string } | null } | undefined)?.user?.id;
    const worker = $page.params?.id;
    if (!viewer || !worker || $page.route?.id !== '/app/workers/[id]') return;
    shown = takeRefreshMarker({ viewer, worker });
  });
</script>

{#if shown}
  <p role="status" class="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="apply-refresh-failed-page">
    {applyRefreshFailedLine()}
  </p>
{/if}
