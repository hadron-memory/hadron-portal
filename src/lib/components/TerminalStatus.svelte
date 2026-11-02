<!--
  TerminalStatus (portal#1492) — a worker's terminal state as a badge, with the
  reason in words and how old the report is. Text carries the state; the colour
  only echoes it. Passed null, it renders nothing, so a caller that must not
  show a badge (hidden, no roster entry, failed read) needs no branch of its own.

  `compact` is the grid cell: one line, "Locked: Model at capacity", then the age.
  The full form (worker page) puts the reason and the last turn on lines of their own.
-->
<script lang="ts">
  import { terminalCheckedAge, terminalLastTurn, terminalSummary, type TerminalBadge } from '$lib/workers/terminal';

  let { badge, now, compact = false }: { badge: TerminalBadge | null; now: number; compact?: boolean } = $props();

  const tone = $derived(
    badge?.state === 'dark'
      ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
      : badge?.state === 'locked'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
        : badge?.state === 'busy'
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
          : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  );
</script>

{#if badge}
  {#if compact}
    <span class="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <!-- portal#1495 (Uma, UX): the longest "State: Reason" pill used to wrap into a
           two-line capsule in the 220px column; one line, ellipsis, full text on hover. -->
      <span class="max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium {tone}" title={terminalSummary(badge)}>{terminalSummary(badge)}</span>
      {#if badge.state !== 'not-reported'}
        <span class="text-xs text-zinc-500 dark:text-zinc-400">{terminalCheckedAge(badge.checkedAt, now)}</span>
      {/if}
    </span>
  {:else}
    <div class="space-y-1">
      <span class="inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium {tone}" title={badge.label}>{badge.label}</span>
      {#if badge.reason}<div class="text-sm text-zinc-900 dark:text-white">{badge.reason}</div>{/if}
      {#if badge.state !== 'not-reported'}
        <!-- portal#1495 (Uma, UX): zinc-500 on the dark panels measured ~4:1; zinc-400 clears 7:1. -->
        <div class="text-xs text-zinc-500 dark:text-zinc-400">{terminalLastTurn(badge.lastTurnAt, now)}</div>
        <div class="text-xs text-zinc-500 dark:text-zinc-400">{terminalCheckedAge(badge.checkedAt, now)}</div>
      {/if}
    </div>
  {/if}
{/if}
