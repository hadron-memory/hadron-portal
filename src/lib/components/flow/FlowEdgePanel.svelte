<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import ConditionBuilder from '$lib/edge-conditions/ConditionBuilder.svelte';
  import { describeCondition } from '$lib/edge-conditions/describe';
  import type { UiCondition } from '$lib/edge-conditions/types';
  import type { KnownVariable } from '$lib/edge-conditions/known-variables';
  import type { FlowEdgeDetail } from '$lib/flow/canvas';
  import {
    conditionJsonFor,
    conditionSummary,
    previewFiringOrder,
    routingToggleSeed,
    seedConditionState,
    seedRoutingState,
  } from '$lib/flow/edge-editing';
  import { buildRoutingName, isRoutingName } from '$lib/flow/routing';
  import { t } from '$lib/i18n/t';

  // Edge editing side panel for the flow canvas (#510 increment 1). The
  // editable subset mirrors the edge editor page (routing name, priority,
  // condition); everything else lives behind the "Full editor" link. The
  // page keys this component by edge id, so local state seeds at init and
  // never needs reseeding.
  let {
    edge,
    siblings,
    flowFields,
    basePath,
    saved,
    error,
    onClose,
  }: {
    edge: FlowEdgeDetail;
    /** All displayed edges leaving the same source node (including this one). */
    siblings: FlowEdgeDetail[];
    flowFields: KnownVariable[];
    basePath: string;
    saved: boolean;
    error: string | null;
    onClose: () => void;
  } = $props();

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  // ── Seed once from the loaded edge (the page keys the panel by edge id;
  // untrack silences state_referenced_locally for the initial reads). As on
  // the edge editor page, a condition the visual builder can't represent is
  // shown read-only and preserved verbatim on save (seedConditionState).
  const seeded = untrack(() => seedConditionState(edge.condition));
  let condition = $state<UiCondition>(seeded.ui);
  const conditionError = seeded.error;

  let name = $state(untrack(() => edge.name ?? ''));
  let priority = $state(untrack(() => String(edge.priority ?? 0)));

  const seededRouting = untrack(() => seedRoutingState(edge, edge.sourceLoc));
  let isRouting = $state(seededRouting.routing);
  // string | number | null: seeded as string, but the number-input binding
  // writes numbers/null back (see routingIndexTrimmed below).
  let routingIndexText = $state<string | number | null>(seededRouting.indexText);
  let routingLabel = $state(seededRouting.label);

  // Svelte coerces a number-input binding through to_number(), so after the
  // user types, routingIndexText holds a number (or null when cleared), not a
  // string — normalize before every string operation or .trim() throws.
  const routingIndexTrimmed = $derived(String(routingIndexText ?? '').trim());

  function setRouting(on: boolean) {
    isRouting = on;
    if (!on) return;
    const seed = routingToggleSeed(name, routingIndexTrimmed, siblings, edge.sourceLoc);
    if (seed) {
      routingIndexText = seed.indexText;
      routingLabel = seed.label;
    }
  }

  const routingIndexValid = $derived(
    routingIndexTrimmed === '' || /^\d+$/.test(routingIndexTrimmed),
  );
  const routingName = $derived(
    buildRoutingName(
      routingIndexValid && routingIndexTrimmed !== '' ? Number(routingIndexTrimmed) : null,
      routingLabel,
    ),
  );
  const effectiveName = $derived(isRouting ? routingName : name);

  const conditionJson = $derived(conditionJsonFor(conditionError, edge.condition, condition));
  const conditionPreview = $derived(conditionError ? null : describeCondition(condition));

  // Live firing order among the source node's edges with THIS edge's unsaved
  // values substituted — same preview the edge editor page shows.
  const firingOrder = $derived.by(() =>
    previewFiringOrder(siblings, edge.sourceLoc, {
      id: edge.id,
      name: effectiveName,
      priorityText: priority,
      condition,
      conditionError,
    }),
  );
</script>

<!-- Side-by-side with the canvas on lg+; stacked (and height-capped) below it
     on narrow screens, where a fixed-width panel would starve the canvas. -->
<aside
  class="flex w-full shrink-0 flex-col overflow-y-auto rounded-xl border border-zinc-200 bg-white p-4 max-lg:max-h-[50%] lg:h-full lg:w-96 dark:border-zinc-800 dark:bg-zinc-900"
  aria-label={t('flow.panel.title', 'Edit edge')}
>
  <div class="mb-3 flex items-start justify-between gap-2">
    <div class="min-w-0">
      <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">
        {t('flow.panel.title', 'Edit edge')}
      </h3>
      <p class="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
        {edge.sourceName || edge.sourceLoc} → {edge.targetName || edge.targetLoc}
      </p>
      <p class="truncate font-mono text-[10px] text-zinc-400">{edge.loc}</p>
    </div>
    <button
      type="button"
      onclick={onClose}
      aria-label={t('flow.panel.close', 'Close panel')}
      class="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
    >
      ✕
    </button>
  </div>

  {#if error}
    <div class="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {error}
    </div>
  {/if}
  {#if saved}
    <div class="mb-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-xs text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
      {t('flow.panel.saved', 'Edge saved.')}
    </div>
  {/if}

  <form method="POST" action="?/updateEdge" use:enhance class="space-y-4">
    <input type="hidden" name="edgeId" value={edge.id} />

    <div>
      <label class="flex items-center gap-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={isRouting}
          onchange={(e) => setRouting((e.currentTarget as HTMLInputElement).checked)}
          class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800"
        />
        {t('edge-editor.routing.toggle', 'Flow routing edge')}
      </label>
    </div>

    {#if isRouting}
      <div class="flex items-start gap-3">
        <div class="w-24">
          <label for="panelRoutingOrder" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t('edge-editor.routing.order', 'Order')}
          </label>
          <input
            id="panelRoutingOrder"
            type="number"
            min="0"
            step="1"
            bind:value={routingIndexText}
            class={inputClass}
          />
        </div>
        <div class="min-w-0 flex-1">
          <label for="panelRoutingLabel" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
            {t('edge-editor.routing.label', 'Label (optional)')}
          </label>
          <input
            id="panelRoutingLabel"
            type="text"
            bind:value={routingLabel}
            placeholder={t('edge-editor.routing.label.placeholder', 'e.g. high confidence')}
            class={inputClass}
          />
        </div>
      </div>
      <p class="text-xs {routingIndexValid ? 'text-zinc-400' : 'text-red-500'}">
        {#if routingIndexValid}
          {t('edge-editor.routing.generated', 'Saved as')}
          <span class="font-mono text-zinc-500 dark:text-zinc-300">{routingName}</span>
        {:else}
          {t('edge-editor.routing.order.invalid', 'Must be a whole number.')}
        {/if}
      </p>
      <input type="hidden" name="name" value={routingName} />
    {:else}
      <div>
        <label for="panelEdgeName" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
          {t('flow.panel.name', 'Relationship name')}
        </label>
        <input
          id="panelEdgeName"
          name="name"
          type="text"
          bind:value={name}
          placeholder={t('flow.panel.name.placeholder', 'e.g. cites, depends_on')}
          class={inputClass}
        />
        {#if isRoutingName(name)}
          <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {t(
              'edge-editor.routing.name-warning',
              'Names starting with “next” make this a routing edge — turn on Flow routing above to edit the order and label instead of the raw name.',
            )}
          </p>
        {/if}
      </div>
    {/if}

    <div class="w-28">
      <label for="panelPriority" class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t('flow.panel.priority', 'Priority')}
      </label>
      <input id="panelPriority" name="priority" type="number" step="1" bind:value={priority} class={inputClass} />
      <p class="mt-1 text-xs text-zinc-400">{t('flow.panel.priority.hint', 'Lower = earlier.')}</p>
    </div>

    <div>
      <span class="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
        {t('flow.panel.condition', 'Condition')}
      </span>
      {#if conditionError}
        <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          {t(
            'flow.panel.condition.unrepresentable',
            "This condition uses an expression the visual builder can't edit. It's shown read-only and will be preserved unchanged when you save.",
          )}
        </div>
        <pre class="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-2 font-mono text-[10px] text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{JSON.stringify(edge.condition, null, 2)}</pre>
      {:else}
        <ConditionBuilder bind:value={condition} extraVariables={flowFields} />
        <p class="mt-2 text-xs italic text-zinc-500 dark:text-zinc-400">
          {#if conditionPreview}
            {t('edge-editor.preview.fires', 'Fires')} {conditionPreview}.
          {:else if isRouting}
            {t('edge-editor.preview.fall-through', 'Always fires — the fall-through branch.')}
          {/if}
        </p>
      {/if}
      <input type="hidden" name="condition" value={conditionJson} />
    </div>

    <div class="flex items-center gap-3">
      <button
        type="submit"
        disabled={isRouting && !routingIndexValid}
        class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        style="background: #fb8500;"
      >
        {t('flow.panel.save', 'Save edge')}
      </button>
      <a
        href="{basePath}/nodes/{edge.sourceId}/edges/{edge.id}"
        class="text-xs text-indigo-600 hover:underline dark:text-indigo-300"
      >
        {t('flow.panel.fullEditor', 'Full editor →')}
      </a>
    </div>
  </form>

  {#if firingOrder.length > 0}
    <div class="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <h4 class="text-xs font-semibold text-zinc-900 dark:text-white">
        {t('edge-editor.order.title', 'Flow routing from')} “{edge.sourceName || edge.sourceLoc}”
      </h4>
      <ol class="mt-2 space-y-1.5">
        {#each firingOrder as entry (entry.edge.id)}
          {@const isCurrent = entry.edge.id === edge.id}
          <li
            class="rounded-lg border px-2 py-1.5 text-xs
              {isCurrent
              ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40'
              : 'border-zinc-200 dark:border-zinc-800'}
              {entry.isUnreachable ? 'opacity-60' : ''}"
          >
            <span class="font-mono text-zinc-400">{entry.position}.</span>
            <span class="font-mono text-zinc-600 dark:text-zinc-300">{entry.routingName}</span>
            <span class="text-zinc-400">→</span>
            <span class="font-medium text-zinc-800 dark:text-zinc-100">
              {entry.edge.targetName || entry.edge.targetLoc}
            </span>
            <span class="block italic text-zinc-500 dark:text-zinc-400">
              {#if entry.isUnreachable}
                {t('edge-editor.order.unreachable', 'never reached — an earlier branch always fires')}
              {:else if entry.isFallThrough}
                {t('edge-editor.order.fall-through', 'always fires (fall-through)')}
              {:else}
                {conditionSummary(entry.edge.condition)}
              {/if}
            </span>
          </li>
        {/each}
      </ol>
    </div>
  {/if}
</aside>
