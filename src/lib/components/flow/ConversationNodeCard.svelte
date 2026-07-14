<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { t } from '$lib/i18n/t';

  // Card data assembled by ConversationCanvas from a ConversationCanvasNode
  // of kind 'stage' or 'topic'.
  interface StageCardData extends Record<string, unknown> {
    label: string;
    loc: string;
    kind: 'stage' | 'topic';
    stageIndex: number | null;
    extractionFields: string[];
    isSelected: boolean;
  }

  let { data }: NodeProps = $props();
  // $derived, not a const: isSelected changes after init (the canvas remaps
  // node data on selection) and must keep flowing into the card.
  const card = $derived(data as StageCardData);
</script>

<div
  class="h-full w-full rounded-lg border bg-white p-2 text-left shadow-sm dark:bg-zinc-900
    {card.kind === 'topic'
    ? 'border-blue-300 dark:border-blue-800'
    : 'border-zinc-300 dark:border-zinc-700'}
    {card.isSelected ? 'ring-2 ring-indigo-500' : ''}"
>
  <Handle type="target" position={Position.Left} class="!bg-zinc-400" />

  <div class="flex items-start gap-1.5">
    {#if card.stageIndex != null}
      <span
        class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-sky-600 text-[9px] font-bold text-white"
      >
        {card.stageIndex}
      </span>
    {:else if card.kind === 'topic'}
      <span class="mt-0.5 shrink-0 text-[8px] font-semibold tracking-wider text-blue-500">
        {t('conversation.card.topic', 'TOPIC')}
      </span>
    {/if}
    <div class="min-w-0">
      <div class="truncate text-xs font-medium text-zinc-900 dark:text-white">{card.label}</div>
      <div class="truncate font-mono text-[9px] text-zinc-400">{card.loc}</div>
    </div>
  </div>

  {#if card.extractionFields.length > 0}
    <div class="mt-1 flex flex-wrap gap-1">
      {#each card.extractionFields as field (field)}
        <span
          class="truncate rounded bg-indigo-50 px-1 py-0.5 font-mono text-[9px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
        >
          ⤓ {field}
        </span>
      {/each}
    </div>
  {/if}

  <Handle type="source" position={Position.Right} class="!bg-zinc-400" />
</div>
