<!--
  portal#1052 — one party to a task (design §3).

  - A worker: its name linked to its page, the AI-worker badge, and its URN
    below (hrn:node:hadronmemory.com:hadron-portal:review:render-urn).
  - A person: the name only. A person has no URN in this shape, so none is
    rendered, never an empty chip.
  - No party: the caller's `empty` text (e.g. "Nobody yet").
-->
<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import WorkerBadge from '$lib/components/WorkerBadge.svelte';
  import { partyName } from '$lib/agent-tasks/status';
  import type { AgentTaskParty } from '$lib/agent-tasks/types';

  let {
    party,
    empty = '—',
    emptyTitle,
    showUrn = true,
  }: { party: AgentTaskParty | null; empty?: string; emptyTitle?: string; showUrn?: boolean } = $props();
</script>

{#if !party}
  <span class="text-zinc-500 dark:text-zinc-400" title={emptyTitle}>{empty}</span>
{:else if party.kind === 'WORKER'}
  <span class="inline-flex max-w-full min-w-0 flex-col">
    <span class="inline-flex min-w-0 items-center gap-1.5">
      <a href="/app/workers/{party.id}" class="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300" title={partyName(party)}>{partyName(party)}</a>
      <WorkerBadge size="xs" />
    </span>
    {#if showUrn && party.urn}
      <!-- portal#2413: no overflow clip here. A clipping ancestor cuts the copy
           buttons' focus ring at its edge, and the Urn chip already truncates
           itself (min-w-0 + truncate), so this wrapper need not clip. -->
      <span class="block max-w-full min-w-0"><Urn value={party.urn} type="worker" size={10} compact /></span>
    {/if}
  </span>
{:else}
  <span class="truncate text-zinc-800 dark:text-zinc-200">{partyName(party)}</span>
{/if}
