<script lang="ts">
  import { Handle, Position, type NodeProps } from '@xyflow/svelte';
  import { t } from '$lib/i18n/t';

  // Card data assembled by FlowCanvas from a FlowCanvasNode.
  interface FlowCardData extends Record<string, unknown> {
    name: string;
    loc: string;
    kind: 'flow' | 'reference';
    isEntry: boolean;
    isFocus: boolean;
    extractionFields: string[];
    tools: string[];
    outputWriteTo: string | null;
    href: string;
  }

  let { data }: NodeProps = $props();
  const card = $derived(data as FlowCardData);
</script>

<div
  class="w-60 rounded-xl border bg-white p-3 text-left shadow-sm dark:bg-zinc-900
    {card.kind === 'reference'
    ? 'border-dashed border-zinc-300 opacity-80 dark:border-zinc-700'
    : 'border-zinc-200 dark:border-zinc-700'}
    {card.isFocus ? 'ring-2 ring-indigo-500' : ''}"
>
  <Handle type="target" position={Position.Left} class="!bg-zinc-400" />

  <div class="flex items-start justify-between gap-2">
    <div class="min-w-0">
      <a
        href={card.href}
        class="block truncate text-sm font-semibold text-zinc-900 hover:text-indigo-600 dark:text-white dark:hover:text-indigo-400"
      >
        {card.name || card.loc}
      </a>
      <div class="truncate font-mono text-[10px] text-zinc-400">{card.loc}</div>
    </div>
    {#if card.isEntry}
      <span
        class="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/50 dark:text-green-300"
      >
        {t('flow.card.entry', 'entry')}
      </span>
    {:else if card.kind === 'reference'}
      <span
        class="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
      >
        {t('flow.card.reference', 'reference')}
      </span>
    {/if}
  </div>

  {#if card.extractionFields.length > 0}
    <div class="mt-2 flex flex-wrap gap-1">
      {#each card.extractionFields as field (field)}
        <span
          class="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
        >
          ⤓ {field}
        </span>
      {/each}
    </div>
  {/if}

  {#if card.tools.length > 0}
    <div class="mt-2 flex flex-wrap gap-1">
      {#each card.tools as tool (tool)}
        <span
          class="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] text-amber-700 dark:bg-amber-950 dark:text-amber-300"
        >
          🔧 {tool}
        </span>
      {/each}
    </div>
  {/if}

  {#if card.outputWriteTo}
    <div class="mt-2">
      <span
        class="rounded bg-sky-50 px-1.5 py-0.5 font-mono text-[10px] text-sky-700 dark:bg-sky-950 dark:text-sky-300"
      >
        ✎ {card.outputWriteTo}
      </span>
    </div>
  {/if}

  <!-- Reference nodes can't START a connection: their outgoing edges are never
       fetched by the flow loader (BFS walks routing edges from the focus), so a
       reference→reference edge would be created but never rendered. Receiving a
       connection is fine — the source is a fetched flow node, and the reload
       promotes the target. -->
  <Handle
    type="source"
    position={Position.Right}
    class="!bg-zinc-400"
    isConnectable={card.kind !== 'reference'}
  />
</div>
