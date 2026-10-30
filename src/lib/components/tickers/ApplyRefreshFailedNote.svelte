<!--
  portal#1462 (Xavier's ruling A, #51237) — rendered inside the error boundaries that can catch a worker page's
  failed refresh. The panel that applied the tickers is gone by now, so this says what is true: the apply was
  committed, the page could not reload, reloading shows the list, and nothing is applied again from here.

  Shown once, and only to the viewer and worker whose marker is live (see $lib/tickers/refresh-marker). It reads
  storage after mount, so a server render and a hydration agree on nothing shown.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/stores';
  import { applyRefreshFailedLine } from '$lib/tickers/apply';
  import { takeRefreshMarker } from '$lib/tickers/refresh-marker';

  // The scope the CURRENT page is in. A boundary kit reuses across error navigations keeps this instance, so
  // everything below follows these, never a one-time read (Anne's P2 on 7290cfe4).
  const viewer = $derived(($page.data as { user?: { id?: string } | null } | undefined)?.user?.id ?? null);
  const worker = $derived($page.params?.id ?? null);
  const orgId = $derived(($page.data as { activeOrgId?: string | null } | undefined)?.activeOrgId ?? null);
  const onWorker = $derived($page.route?.id === '/app/workers/[id]');

  // The scope whose marker this instance consumed. Replaced (or dropped) whenever the page's scope changes, so
  // a claim made for one viewer/worker is never shown for another, nor again on coming back to it.
  let consumed = $state<{ viewer: string; worker: string } | null>(null);
  $effect(() => {
    const v = viewer;
    const w = worker;
    const ok = onWorker;
    const org = orgId;
    untrack(() => {
      consumed = v && w && ok && takeRefreshMarker({ viewer: v, worker: w, orgId: org }) ? { viewer: v, worker: w } : null;
    });
  });
  const shown = $derived(consumed !== null && onWorker && consumed.viewer === viewer && consumed.worker === worker);
</script>

{#if shown}
  <p role="status" class="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="apply-refresh-failed-page">
    {applyRefreshFailedLine()}
  </p>
{/if}
