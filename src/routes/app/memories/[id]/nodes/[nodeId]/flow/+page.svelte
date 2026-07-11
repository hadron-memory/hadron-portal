<script lang="ts">
  import { enhance } from '$app/forms';
  import { tick } from 'svelte';
  import { t } from '$lib/i18n/t';
  import FlowCanvas from '$lib/components/flow/FlowCanvas.svelte';
  import FlowEdgePanel from '$lib/components/flow/FlowEdgePanel.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let canvasHeight = $state(480);

  const basePath = $derived(`/app/memories/${data.memoryId}`);
  const nodeHref = $derived(`${basePath}/nodes/${data.focusId}`);
  const routingEdgeCount = $derived(data.canvas.edges.filter((e) => e.kind === 'routing').length);

  // ── Edge selection → side panel (#510). Derived against the CURRENT load
  // payload, so a selected edge that disappears (deleted in the full editor,
  // renamed out of the graph) closes the panel instead of showing stale data.
  let selectedEdgeId = $state<string | null>(null);
  const selectedEdge = $derived(data.edgeDetails.find((e) => e.id === selectedEdgeId) ?? null);
  const selectedSiblings = $derived(
    selectedEdge ? data.edgeDetails.filter((e) => e.sourceId === selectedEdge.sourceId) : [],
  );

  // updateEdge results are scoped to the edge they were submitted for, so a
  // stale banner never shows on a different edge's panel.
  const panelSaved = $derived(!!form?.saved && form?.edgeId === selectedEdge?.id);
  const panelError = $derived(
    form?.error != null && form?.edgeId === selectedEdge?.id ? (form.error as string) : null,
  );

  // ── Drag-to-connect (#510): SvelteFlow's onconnect fills this hidden form,
  // which posts to the createEdge action; on success the new edge is selected
  // so its condition can be refined right away.
  let connectSourceId = $state('');
  let connectTargetId = $state('');
  let connectForm: HTMLFormElement | undefined = $state();
  let connectPending = $state(false);

  async function handleConnect(sourceId: string, targetId: string) {
    if (connectPending) return;
    connectSourceId = sourceId;
    connectTargetId = targetId;
    await tick();
    connectForm?.requestSubmit();
  }
</script>

<svelte:head>
  <title>{data.focusName} — {t('flow.canvas.title', 'Flow canvas')}</title>
</svelte:head>

<div class="flex h-full min-h-0 flex-col">
  <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
    <div>
      <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">
        {t('flow.canvas.title', 'Flow canvas')}
      </h2>
      <p class="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">
        {t(
          'flow.canvas.intro.editable',
          'The multi-node flow around this node. Click an edge to edit its routing and condition; drag between node handles to add a routing edge.',
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

  <!-- Errors not tied to the panel's edge (createEdge failures) surface here. -->
  {#if form?.error != null && !panelError}
    <div
      class="mb-3 rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
    >
      {form.error}
    </div>
  {/if}

  {#if routingEdgeCount === 0}
    <div
      class="mb-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-2 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400"
    >
      {t(
        'flow.canvas.noRouting.editable',
        'This node has no routing (next*) edges yet — it runs as a single-node flow. Drag from its right handle to another node to add one.',
      )}
    </div>
  {/if}

  <!-- SvelteFlow needs a definite pixel height: its height:100% resolves to 0
       through this flex/min-height chain, so measure the box and pass px down. -->
  <div
    class="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row"
    style="height: calc(100vh - 290px); min-height: 480px;"
  >
    <div
      bind:clientHeight={canvasHeight}
      class="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800"
    >
      <FlowCanvas
        model={data.canvas}
        focusId={data.focusId}
        {basePath}
        height={canvasHeight}
        selectedEdgeId={selectedEdge?.id ?? null}
        onEdgeSelect={(id) => (selectedEdgeId = id)}
        onConnect={handleConnect}
      />
    </div>
    {#if selectedEdge}
      {#key selectedEdge.id}
        <FlowEdgePanel
          edge={selectedEdge}
          siblings={selectedSiblings}
          flowFields={data.flowFieldsByNode[selectedEdge.sourceId] ?? []}
          {basePath}
          saved={panelSaved}
          error={panelError}
          onClose={() => (selectedEdgeId = null)}
        />
      {/key}
    {/if}
  </div>

  <form
    bind:this={connectForm}
    method="POST"
    action="?/createEdge"
    class="hidden"
    use:enhance={() => {
      connectPending = true;
      return async ({ result, update }) => {
        await update();
        connectPending = false;
        if (result.type === 'success' && typeof result.data?.edgeId === 'string') {
          selectedEdgeId = result.data.edgeId;
        }
      };
    }}
  >
    <input type="hidden" name="sourceId" value={connectSourceId} />
    <input type="hidden" name="targetId" value={connectTargetId} />
  </form>
</div>
