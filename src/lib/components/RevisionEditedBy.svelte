<!--
  #1171 — the editor of a History row: the user, plus the Worker and Agent
  behind the edit when the server recorded them. Each referenced actor shows its
  URN (hrn:node:hadronmemory.com:hadron-portal:review:render-urn); an absent
  actor renders nothing.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { RevisionEditorView } from '$lib/revision-editor';
  import RevisionEditor from './RevisionEditor.svelte';
  import Urn from './Urn.svelte';

  /** actorsOnly: the page already shows the user; add only the worker and agent. */
  let { view, actorsOnly = false }: { view: RevisionEditorView; actorsOnly?: boolean } = $props();
</script>

<div class="min-w-0">
  {#if actorsOnly}
    <!-- the caller shows the user -->
  {:else if view.user}
    {#if view.user.handle}<div class="truncate"><RevisionEditor handle={view.user.handle} urn={view.user.urn} /></div>{/if}
    {#if view.user.urn}<Urn value={view.user.urn} type="user" size={9} />{/if}
  {:else}
    <span class="whitespace-nowrap text-zinc-500 dark:text-zinc-400">{view.info ?? '—'}</span>
  {/if}
  {#if view.worker}
    <div data-testid="revision-worker" class="mt-1 min-w-0">
      <div class="truncate text-xs text-zinc-600 dark:text-zinc-400">{t('node.history.worker', 'Worker')}: {view.worker.name}</div>
      {#if view.worker.urn}<Urn value={view.worker.urn} type="worker" linked size={9} />{/if}
    </div>
  {/if}
  {#if view.agent}
    <div data-testid="revision-agent" class="mt-1 min-w-0">
      <div class="truncate text-xs text-zinc-600 dark:text-zinc-400">{t('node.history.agent', 'Agent')}: {view.agent.name}</div>
      {#if view.agent.urn}<Urn value={view.agent.urn} type="agent" linked size={9} />{/if}
    </div>
  {/if}
</div>
