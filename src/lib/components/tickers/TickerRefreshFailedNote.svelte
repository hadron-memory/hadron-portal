<!--
  portal#1497 — rendered inside the ticker route's error boundary, which is
  where a failed refresh lands after a COMMITTED on/off or subscriber action:
  the control that ran it is unmounted by then, so this says what is true (the
  write was saved, the page could not reload, nothing is sent again from here).

  Shown once, and only to the viewer, App and ticker whose marker is live (see
  $lib/tickers/ticker-refresh-marker — the TICKER-scoped marker, never the
  worker-apply one). It reads storage after mount, so a server render and a
  hydration agree on nothing shown.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { page } from '$app/stores';
  import { tickerOfPage } from '$lib/tickers/refresh-page';
  import { takeTickerRefreshMarker } from '$lib/tickers/ticker-refresh-marker';
  import { tickerRefreshFailedLine } from '$lib/tickers/controls';

  // The scope the CURRENT page is in. A boundary kit reuses across error navigations keeps this
  // instance, so everything below follows these, never a one-time read.
  const viewer = $derived(($page.data as { user?: { id?: string } | null } | undefined)?.user?.id ?? null);
  const at = $derived(tickerOfPage($page));
  // The error this instance is showing. Kit reuses a boundary across error navigations at the same
  // scope, and a claim consumed for one error is not a claim about the next.
  const error = $derived($page.error);
  const status = $derived($page.status);

  // The scope AND error whose marker this instance consumed. Replaced (or dropped) whenever either
  // changes, so a claim made for one viewer/ticker/error is never shown for another, nor again on
  // coming back to it.
  let consumed = $state<{ viewer: string; appId: string; tickerId: string } | null>(null);
  $effect(() => {
    const v = viewer;
    const a = at;
    void error;
    void status;
    untrack(() => {
      consumed = v && a && takeTickerRefreshMarker({ viewer: v, appId: a.appId, tickerId: a.tickerId }) ? { viewer: v, ...a } : null;
    });
  });
  const shown = $derived(consumed !== null && consumed.viewer === viewer && at !== null && consumed.appId === at.appId && consumed.tickerId === at.tickerId);
</script>

{#if shown}
  <p role="status" class="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="ticker-refresh-failed-page">
    {tickerRefreshFailedLine()}
  </p>
{/if}
