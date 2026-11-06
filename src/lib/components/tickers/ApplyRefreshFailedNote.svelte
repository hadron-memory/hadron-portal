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
  import { t } from '$lib/i18n/t';
  import { workerOfPage } from '$lib/tickers/refresh-page';
  import { takeRefreshMarker } from '$lib/tickers/refresh-marker';

  // The scope the CURRENT page is in. A boundary kit reuses across error navigations keeps this instance, so
  // everything below follows these, never a one-time read (Anne's P2 on 7290cfe4).
  const viewer = $derived(($page.data as { user?: { id?: string } | null } | undefined)?.user?.id ?? null);
  const worker = $derived(workerOfPage($page));
  const orgId = $derived(($page.data as { activeOrgId?: string | null } | undefined)?.activeOrgId ?? null);
  // The error this instance is showing. Kit reuses a boundary across error navigations at the same scope, and a
  // claim consumed for one error is not a claim about the next (George's P2 on b3fa8201).
  const error = $derived($page.error);
  const status = $derived($page.status);

  // The scope AND error whose marker this instance consumed. Replaced (or dropped) whenever either changes, so a
  // claim made for one viewer/worker/error is never shown for another, nor again on coming back to it.
  let consumed = $state<{ viewer: string; worker: string } | null>(null);
  $effect(() => {
    const v = viewer;
    const w = worker;
    const org = orgId;
    void error;
    void status;
    untrack(() => {
      consumed = v && w && takeRefreshMarker({ viewer: v, worker: w, orgId: org }) ? { viewer: v, worker: w } : null;
    });
  });
  const shown = $derived(consumed !== null && consumed.viewer === viewer && consumed.worker === worker);
  // A native GET reload, never the named POST action in the failed request's query. Keep harmless view state.
  const reloadHref = $derived.by(() => {
    const query = new URLSearchParams($page.url.search);
    for (const key of [...query.keys()]) if (key.startsWith('/')) query.delete(key);
    const search = query.toString();
    return `${$page.url.pathname}${search ? `?${search}` : ''}`;
  });
</script>

{#if shown}
  <p role="status" class="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200" data-testid="apply-refresh-failed-page">
    {applyRefreshFailedLine()}
    <a href={reloadHref} data-sveltekit-reload class="mt-2 block w-fit rounded-md px-3 py-2 font-medium underline underline-offset-2 outline-offset-2 focus-visible:outline-2 focus-visible:outline-current">{t('worker.apply.reload', 'Reload this page')}</a>
  </p>
{/if}
