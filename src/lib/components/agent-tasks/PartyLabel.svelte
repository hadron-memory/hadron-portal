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
      <!-- portal#2506: a one-line clamp with [overflow-wrap:anywhere], not
           `truncate`. A nowrap element's min-content is its full text width,
           and min-w-0 up the chain does not shrink intrinsic contributions —
           so inside a caller wrapper that omits max-w-full/min-w-0 (the
           roster's reportsTo cell) the name forced the whole stack past the
           cell. The clamp keeps the one-line ellipsis and the title;
           `anywhere` (not `break-word`) is what collapses min-content. -->
      <a href="/app/workers/{party.id}" class="line-clamp-1 [overflow-wrap:anywhere] font-medium text-indigo-600 hover:underline dark:text-indigo-300" title={partyName(party)}>{partyName(party)}</a>
      <WorkerBadge size="xs" />
    </span>
    {#if showUrn && party.urn}
      <!-- portal#2413: no overflow clip here. A clipping ancestor cuts the copy
           buttons' focus ring at its edge, and the Urn chip already truncates
           itself (min-w-0 + the #2506 clamp), so this wrapper need not clip. -->
      <span class="block max-w-full min-w-0"><Urn value={party.urn} type="worker" size={10} compact /></span>
    {/if}
  </span>
{:else}
  <!-- portal#2506: the same clamp as the worker name; the title keeps the full
       name reachable where the clamp ellipsizes it. -->
  <span class="line-clamp-1 [overflow-wrap:anywhere] text-zinc-800 dark:text-zinc-200" title={partyName(party)}>{partyName(party)}</span>
{/if}
