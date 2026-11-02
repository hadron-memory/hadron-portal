<!--
  portal#1609 — delete one Agent ticker template. Two steps (Delete, then
  Confirm) so a stray click removes nothing. The delete names the revision the
  page read; a stale one is refused, never retried. Tickers already made from
  the template are untouched (hrn:node:hadronmemory.com:specs:cor:agt:080:34).
-->
<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import type { AgentTickerTemplate } from '$lib/tickers/types';

  let { agentId, template }: { agentId: string; template: Pick<AgentTickerTemplate, 'id' | 'name' | 'revision'> } = $props();

  let confirming = $state(false);
  let submitting = $state(false);
  let refusal = $state<WriteRefusal | null>(null);
  let refreshFailed = $state(false);
  let alertEl = $state<HTMLElement | null>(null);
  let deleteBtn = $state<HTMLButtonElement | null>(null);
  let confirmBtn = $state<HTMLButtonElement | null>(null);

  // The step swaps one button for another, so focus is moved on purpose: a
  // keyboard or screen-reader user must not be dropped on <body> mid-delete.
  async function openConfirm() {
    confirming = true;
    await tick();
    confirmBtn?.focus();
  }
  async function cancelConfirm() {
    confirming = false;
    refusal = null;
    await tick();
    deleteBtn?.focus();
  }

  let generation = 0;
  let seededFor = $state<string | null>(null);
  $effect.pre(() => {
    const key = `${agentId}:${template.id}`;
    if (seededFor !== key) {
      generation++;
      confirming = false;
      submitting = false;
      refusal = null;
      refreshFailed = false;
      seededFor = key;
    }
  });
  onDestroy(() => {
    generation++;
  });

  function submitter() {
    return ({ cancel }: { cancel: () => void }) => {
      // Held through the refresh; a second submit while one is in flight is cancelled.
      if (submitting) {
        cancel();
        return;
      }
      const mine = ++generation;
      submitting = true;
      refusal = null;
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        if (mine !== generation) return;
        if (result.type === 'success') {
          try {
            await invalidateAll();
          } catch {
            // The delete is confirmed; only the re-read failed. Say so, never replay it.
            if (mine === generation) refreshFailed = true;
          } finally {
            if (mine === generation) submitting = false;
          }
          return;
        }
        submitting = false;
        refusal =
          result.type === 'failure' && result.data && typeof result.data === 'object' && 'refusal' in result.data
            ? (result.data.refusal as WriteRefusal)
            : { kind: 'uncertain' };
        await tick();
        alertEl?.focus();
      };
    };
  }
</script>

<div class="space-y-2" data-testid="agent-template-delete-{template.id}">
  {#if !confirming}
    <button type="button" bind:this={deleteBtn} onclick={openConfirm} class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
      {t('agent.tickers.delete', 'Delete')}
    </button>
  {:else}
    <form method="POST" action="?/deleteTickerTemplate" use:enhance={submitter()} class="space-y-2">
      <input type="hidden" name="id" value={template.id} />
      <input type="hidden" name="expectedRevision" value={String(template.revision)} />
      <p class="text-sm text-zinc-700 dark:text-zinc-300">
        {t('agent.tickers.delete.confirm', 'Delete {name}? Tickers already made from it keep running.', { name: template.name })}
      </p>
      <div class="flex gap-2">
        <button type="submit" bind:this={confirmBtn} disabled={submitting || refreshFailed} class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
          {#if submitting}{t('agent.tickers.deleting', 'Deleting…')}{:else}{t('agent.tickers.delete.confirm-button', 'Confirm delete')}{/if}
        </button>
        <button type="button" disabled={submitting} onclick={cancelConfirm} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {t('agent.tickers.delete.cancel', 'Cancel')}
        </button>
      </div>
    </form>
  {/if}
  {#if refreshFailed}
    <p role="alert" class="text-sm text-amber-800 dark:text-amber-300" data-testid="agent-template-delete-refresh-failed">
      {t('agent.tickers.write.refresh-failed', 'The server accepted this change, but the page could not load the latest values. Reload to see what is stored. Nothing is sent again.')}
    </p>
  {/if}
  {#if refusal}
    <div bind:this={alertEl} tabindex="-1"><WriteRefusalAlert {refusal} /></div>
  {/if}
</div>
