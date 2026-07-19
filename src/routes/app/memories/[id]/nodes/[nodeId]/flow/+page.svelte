<script lang="ts">
  import { enhance } from '$app/forms';
  import { tick } from 'svelte';
  import { t } from '$lib/i18n/t';
  import FlowCanvas from '$lib/components/flow/FlowCanvas.svelte';
  import FlowEdgePanel from '$lib/components/flow/FlowEdgePanel.svelte';
  import { collectFlowFieldsFor } from '$lib/flow/fields';
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
  // Condition-builder field picker for the open panel, computed lazily from
  // the shipped extraction specs — only one panel can be open, so the server
  // no longer precomputes (and re-sends) every node's upstream field list.
  const selectedFlowFields = $derived(
    selectedEdge ? collectFlowFieldsFor(selectedEdge.sourceId, data.fieldNodes, data.edgeDetails) : [],
  );

  // `form` outlives selection changes, so a result is "acknowledged" the
  // moment the user changes the selection — otherwise re-selecting a saved
  // edge would re-show its stale "Edge saved." banner. Plain variable: every
  // write co-occurs with a selectedEdgeId write, which re-runs the deriveds.
  let acknowledgedForm: ActionData = null;
  function selectEdge(id: string | null) {
    if (id !== selectedEdgeId) acknowledgedForm = form;
    selectedEdgeId = id;
  }

  // updateEdge results are scoped to the edge they were submitted for; the
  // edgeId != null guard keeps edgeId-less results (createEdge failures,
  // missing-edge-id 400s) out of the panel — with both sides undefined the
  // bare comparison would be true and silently swallow the page banner.
  const formIsLive = $derived(form != null && form !== acknowledgedForm);
  const updateForm = $derived((form as { form?: { data?: { edgeId?: string }; message?: App.Superforms.Message } } | null)?.form ?? null);
  const panelSaved = $derived.by(() => {
    if (!formIsLive || !updateForm) return false;
    return updateForm.message?.type === 'success' && updateForm.data?.edgeId === selectedEdge?.id;
  });
  const panelError = $derived.by(() => {
    if (!formIsLive || !updateForm) return null;
    return updateForm.message?.type === 'error' && updateForm.data?.edgeId === selectedEdge?.id
      ? updateForm.message.text
      : null;
  });
  const selectedEdgeForm = $derived.by(() => {
    if (!selectedEdge) return null;
    return formIsLive && updateForm?.data?.edgeId === selectedEdge.id
      ? updateForm
      : data.edgeForms[selectedEdge.id];
  });

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
          'The multi-node flow around this node: solid edges route (numbered in walker firing order), dashed edges are references the walker inlines but never follows. Click an edge to edit it; drag between node handles to add a routing edge.',
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
  {#if formIsLive && form?.error != null && !panelError}
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
        'This node has no routing (next*) edges yet — it runs as a single-node flow. Add a routing edge from the Edges tab, or drag from a node handle when other nodes are on the canvas.',
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
        onEdgeSelect={selectEdge}
        onConnect={handleConnect}
      />
    </div>
    {#if selectedEdge && selectedEdgeForm}
      {#key selectedEdge.id}
        <FlowEdgePanel
          edge={selectedEdge}
          form={selectedEdgeForm}
          siblings={selectedSiblings}
          flowFields={selectedFlowFields}
          {basePath}
          saved={panelSaved}
          error={panelError}
          onClose={() => selectEdge(null)}
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
          // Direct assignment (not selectEdge): the createEdge result must
          // stay live so the freshly opened panel reflects it.
          selectedEdgeId = result.data.edgeId;
        }
      };
    }}
  >
    <input type="hidden" name="sourceId" value={connectSourceId} />
    <input type="hidden" name="targetId" value={connectTargetId} />
  </form>
</div>
