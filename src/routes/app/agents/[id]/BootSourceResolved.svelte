<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import type { ResolvedSource } from '$lib/server/boot-source';
  import { latestRead } from './latest-read';

  // Read-only and never bound to the draft. The text is the server's for this reader,
  // shown as it came: its unavailable-include notice is not styled, explained or parsed.
  let { agentId, nodeId, openedRevision, dirty, shown, refresh }: {
    agentId: string; nodeId: string; openedRevision: number; dirty: boolean; shown: boolean; refresh: number;
  } = $props();

  let read = $state<{ kind: 'idle' | 'loading' | 'failed' } | { kind: 'ready'; revision: number; content: string }>({ kind: 'idle' });
  const reader = latestRead();
  onDestroy(reader.cancel);
  let loadedFor = -1;

  async function load() {
    loadedFor = refresh;
    read = { kind: 'loading' };
    const result = await reader.get<{ node: ResolvedSource }>(`/app/agents/${encodeURIComponent(agentId)}/boot-source/resolved`);
    if (result.kind === 'superseded') return;
    read = result.kind === 'ok' && result.body.node?.id === nodeId
      ? { kind: 'ready', revision: result.body.node.revision, content: result.body.node.content }
      : { kind: 'failed' };
  }
  // Fetched on first showing, and again after a save that changed what's saved.
  $effect(() => {
    if (shown && refresh !== loadedFor) untrack(load);
  });
</script>

<div data-boot-resolved class="space-y-2">
  {#if read.kind === 'failed'}
    <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('agent.boot.resolved-failed', 'Couldn’t load the source as readers see it.')}</p>
  {:else if read.kind === 'ready'}
    <p class="text-xs font-medium text-zinc-700 dark:text-zinc-300">{t('agent.boot.resolved-label', 'Saved revision {n}, as you can read it', { n: read.revision })}</p>
    <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('agent.boot.resolved-not-served', 'This isn’t what workers are served. They get the compiled, approved prompt.')}</p>
    {#if dirty}<p data-boot-resolved-dirty class="text-xs text-amber-700 dark:text-amber-300">{t('agent.boot.resolved-dirty', 'This shows the saved source, not your unsaved changes.')}</p>{/if}
    {#if read.revision !== openedRevision}<p data-boot-resolved-changed class="text-xs text-amber-700 dark:text-amber-300">{t('agent.boot.resolved-changed', 'The saved source changed since you opened it (now revision {n}). Your draft is unchanged.', { n: read.revision })}</p>{/if}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex: a scrollable text region must be reachable by keyboard (WCAG 2.1.1) -->
    <pre tabindex="0" aria-label={t('agent.boot.resolved-text-label', 'The saved source as you can read it')} class="max-h-[32rem] overflow-auto whitespace-pre-wrap rounded-lg border border-zinc-300 bg-zinc-50 p-4 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100">{read.content}</pre>
  {:else}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('agent.boot.resolved-loading', 'Loading...')}</p>
  {/if}
</div>
