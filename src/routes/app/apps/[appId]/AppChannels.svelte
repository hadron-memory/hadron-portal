<script lang="ts">
  import AppChannelsBody from './AppChannelsBody.svelte';
  import { t } from '$lib/i18n/t';
  import type { loadChannelsPanel } from './channels-panel';

  /**
   * #942 — an App's Channels, as the body of a Settings section: the list, the register and the effective view.
   * The section posts to the App page's own actions (`createChannel`, `renameChannel`, `deleteChannel` and the three
   * attendance actions) and reads its own slice again through the tab endpoint after a write; the page is not
   * invalidated. The old /channels page is gone; the effective view's endpoint stays at `channels/effective`.
   */
  type Panel = NonNullable<Awaited<ReturnType<typeof loadChannelsPanel>>>;
  let { appId, panel: initial, form = null, orgIds = [] }: { appId: string; panel: Panel; form?: unknown; orgIds?: string[] } = $props();

  // The panel shown: what the page last handed over, until a re-read of this section replaces it.
  let reread = $state.raw<{ against: Panel; panel: Panel } | null>(null);
  const panel = $derived(reread && reread.against === initial ? reread.panel : initial);
  let readSeq = 0;
  const basePath = $derived(`/app/apps/${appId}`);
  /** Reads the section's slice again. A failed read keeps what is shown; an answer older than one already taken is dropped. */
  async function reload(): Promise<void> {
    const mine = ++readSeq;
    const against = initial;
    const res = await fetch(`${basePath}/tab?tab=channels`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`channels re-read ${res.status}`);
    const next = (await res.json()) as { channelsPanel?: Panel | null };
    // The loader reports its own failure as `{ kind: 'failed' }` with a 200, and a 200 can carry no panel at all: neither
    // may replace a list that is shown, and neither is "refreshed" (Gino's P2 and P3 on #2668).
    if (!next.channelsPanel || next.channelsPanel.kind === 'failed') throw new Error('channels re-read answered no panel');
    if (mine === readSeq) reread = { against, panel: next.channelsPanel };
  }

  let refreshFailed = $state(false);
  // Runs after a write that already landed: a failed re-read must not throw out of the form's handler (the write
  // would go unreported); it only says the list is stale.
  async function onwrite() {
    refreshFailed = false;
    try {
      await reload();
    } catch {
      refreshFailed = true;
    }
  }
  let retrying = $state(false);
  async function retry() {
    retrying = true;
    await onwrite();
    retrying = false;
  }

  // The action URLs name the section: without JavaScript the answer renders the page, and it must open the section.
  const actionUrl = (name: string) => `${basePath}?tab=settings&section=channels&/${name}`;
</script>

{#if panel.kind === 'failed'}
  <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
    {t('app.channels.load-failed', 'Couldn’t load the channels.')}
    <button type="button" onclick={retry} disabled={retrying} class="ml-2 font-medium underline disabled:opacity-50">{t('app.channels.retry', 'Try again')}</button>
    {#if refreshFailed}<span class="ml-2">{t('app.channels.still-failed', 'Still couldn’t load them.')}</span>{/if}
  </div>
{:else}
  {#if refreshFailed}
    <p role="alert" class="mb-3 text-sm text-red-700 dark:text-red-400">{t('app.channels.refresh-failed', 'Couldn’t refresh. What is shown may be out of date.')}</p>
  {/if}
  <AppChannelsBody data={panel} {form} {appId} {orgIds} {onwrite} {actionUrl} />
{/if}
