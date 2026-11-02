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
  let alertEl = $state<HTMLElement | null>(null);

  let generation = 0;
  let seededFor = $state<string | null>(null);
  $effect.pre(() => {
    const key = `${agentId}:${template.id}`;
    if (seededFor !== key) {
      generation++;
      confirming = false;
      submitting = false;
      refusal = null;
      seededFor = key;
    }
  });
  onDestroy(() => {
    generation++;
  });

  function submitter() {
    return () => {
      const mine = ++generation;
      submitting = true;
      refusal = null;
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        if (mine !== generation) return;
        submitting = false;
        if (result.type === 'success') {
          await invalidateAll();
          return;
        }
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
    <button type="button" onclick={() => (confirming = true)} class="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">
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
        <button type="submit" disabled={submitting} class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
          {#if submitting}{t('agent.tickers.deleting', 'Deleting…')}{:else}{t('agent.tickers.delete.confirm-button', 'Confirm delete')}{/if}
        </button>
        <button type="button" disabled={submitting} onclick={() => (confirming = false)} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          {t('agent.tickers.delete.cancel', 'Cancel')}
        </button>
      </div>
    </form>
  {/if}
  {#if refusal}
    <div bind:this={alertEl} tabindex="-1"><WriteRefusalAlert {refusal} /></div>
  {/if}
</div>
