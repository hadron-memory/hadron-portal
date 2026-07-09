<script lang="ts">
  import { t } from '$lib/i18n/t';
  import FlowCanvas from '$lib/components/flow/FlowCanvas.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let canvasHeight = $state(480);

  const basePath = $derived(`/app/memories/${data.memoryId}`);
  const nodeHref = $derived(`${basePath}/nodes/${data.focusId}`);
  const routingEdgeCount = $derived(data.canvas.edges.filter((e) => e.kind === 'routing').length);
</script>

<svelte:head>
  <title>{data.focusName} — {t('flow.canvas.title', 'Flow canvas')}</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div>
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">
        {t('flow.canvas.title', 'Flow canvas')}
        <span class="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-wider text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
          {t('flow.canvas.readonly', 'read-only')}
        </span>
      </h2>
      <p class="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
        {t(
          'flow.canvas.intro',
          'The multi-node flow around this node: solid edges route (numbered in walker firing order), dashed edges are references the walker inlines but never follows.',
        )}
      </p>
    </div>
    <a
      href={nodeHref}
      class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
    >
      ← {t('flow.canvas.back', 'Back to node')}
    </a>
  </div>

  {#if data.truncated || data.referencesDropped > 0}
    <div
      class="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
    >
      {#if data.truncated}
        {t('flow.canvas.truncated', 'Large flow — only the first 40 nodes are shown.')}
      {/if}
      {#if data.referencesDropped > 0}
        {t('flow.canvas.refsDropped', 'Some reference targets were omitted.')}
        ({data.referencesDropped})
      {/if}
    </div>
  {/if}

  {#if routingEdgeCount === 0}
    <div
      class="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
    >
      {t(
        'flow.canvas.noRouting',
        'This node has no routing (next*) edges yet — it runs as a single-node flow. Add a routing edge from the Edges tab to build a multi-node flow.',
      )}
    </div>
  {/if}

  <!-- SvelteFlow needs a definite pixel height: its height:100% resolves to 0
       through this flex/min-height chain, so measure the box and pass px down. -->
  <div
    bind:clientHeight={canvasHeight}
    class="min-h-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
    style="height: calc(100vh - 290px); min-height: 480px;"
  >
    <FlowCanvas model={data.canvas} focusId={data.focusId} {basePath} height={canvasHeight} />
  </div>
</div>
