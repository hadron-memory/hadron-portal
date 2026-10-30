<!--
  portal#1151 (Tickers S7b) — delete a ticker. The user wants to remove it, so
  the one control is "Delete…", and the consequence sits beside the
  confirmation it belongs to. Who may delete is the server's call
  (hrn:node:hadronmemory.com:specs:cor:agt:080:18); a control that has gone stale answers with the server's
  sentence. An uncertain outcome is shown as uncertain and never retried.
-->
<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';

  let {
    appId,
    ticker,
    impersonating = null,
  }: {
    appId: string;
    ticker: { id: string; name: string };
    impersonating?: string | null;
  } = $props();

  let confirming = $state(false);
  let submitting = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let shownFor = $state<string | null>(null);
  let generation = 0;
  $effect.pre(() => {
    if (shownFor !== ticker.id) {
      generation++;
      confirming = false;
      submitting = false;
      refusal = null;
      shownFor = ticker.id;
    }
  });

  function submitter() {
    return () => {
      const mine = ++generation;
      submitting = true;
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        if (mine !== generation) return;
        submitting = false;
        if (result.type === 'success') {
          // The ticker is gone: its own page would 404, so leave it rather than reload it.
          await goto(`/app/apps/${appId}/tickers`, { invalidateAll: true });
          return;
        }
        refusal =
          result.type === 'failure' && result.data && typeof result.data === 'object' && 'refusal' in result.data
            ? (result.data.refusal as WriteRefusal)
            : { kind: 'uncertain' };
      };
    };
  }
</script>

{#if !impersonating}
  <div class="space-y-2">
    {#if !confirming}
      <button
        type="button"
        onclick={() => { confirming = true; refusal = null; }}
        class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950"
      >{t('app.tickers.delete.start', 'Delete…')}</button>
    {:else}
      <form method="POST" action="?/delete" use:enhance={submitter()} class="space-y-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950" data-testid="ticker-delete-confirm">
        <p class="text-red-900 dark:text-red-200">{t('app.tickers.delete.consequence', 'Delete {name}? Its subscriptions end and nobody is woken by it again. Its name can be used again.', { name: ticker.name })}</p>
        <div class="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={submitting} class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
            {submitting ? t('app.tickers.delete.deleting', 'Deleting…') : t('app.tickers.delete.confirm', 'Delete')}
          </button>
          <button type="button" disabled={submitting} onclick={() => (confirming = false)} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.tickers.delete.cancel', 'Cancel')}</button>
        </div>
      </form>
    {/if}
    {#if refusal}<WriteRefusalAlert {refusal} />{/if}
  </div>
{/if}
