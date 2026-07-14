<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { t } from '$lib/i18n/t';

  // Card data assembled by ConversationCanvas from a ConversationCanvasNode
  // of kind 'conversation'. The node carries explicit width/height (the
  // group's extent), so the card just fills it.
  interface GroupCardData extends Record<string, unknown> {
    label: string;
    loc: string;
    isSetup: boolean;
    isFallback: boolean;
    goalCount: number;
    isSelected: boolean;
  }

  let { data }: NodeProps = $props();
  // $derived, not a const: isSelected changes after init (the canvas remaps
  // node data on selection) and must keep flowing into the card.
  const card = $derived(data as GroupCardData);
</script>

<div
  class="h-full w-full rounded-xl border-2 bg-sky-50/60 dark:bg-sky-950/20
    {card.isSelected ? 'border-indigo-500' : 'border-sky-300 dark:border-sky-800'}"
>
  <Handle type="target" position={Position.Left} class="!bg-sky-500" />

  <div class="flex items-start justify-between gap-2 px-3 pt-2">
    <div class="min-w-0">
      <div class="truncate text-sm font-semibold text-zinc-900 dark:text-white">{card.label}</div>
      <div class="truncate font-mono text-[10px] text-zinc-400">{card.loc}</div>
    </div>
    <div class="flex shrink-0 gap-1">
      {#if card.isSetup}
        <span
          class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
        >
          {t('conversation.card.setup', 'setup')}
        </span>
      {/if}
      {#if card.isFallback}
        <span
          class="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
        >
          {t('conversation.card.fallback', 'fallback')}
        </span>
      {/if}
      {#if card.goalCount > 0}
        <span
          class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/50 dark:text-green-300"
        >
          {card.goalCount}
          {card.goalCount === 1
            ? t('conversation.card.goal', 'goal')
            : t('conversation.card.goals', 'goals')}
        </span>
      {/if}
    </div>
  </div>

  <Handle type="source" position={Position.Right} class="!bg-sky-500" />
</div>
