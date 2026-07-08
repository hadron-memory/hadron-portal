<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import ConditionBuilder from '$lib/edge-conditions/ConditionBuilder.svelte';
  import { serialize, deserialize } from '$lib/edge-conditions/serializer';
  import { describeCondition } from '$lib/edge-conditions/describe';
  import type { UiCondition } from '$lib/edge-conditions/types';
  import {
    buildRoutingName,
    isRoutingName,
    nextFreeRoutingIndex,
    parseRoutingName,
    routingNameOf,
    routingOrder,
  } from '$lib/flow/routing';
  import { t } from '$lib/i18n/t';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const edge = $derived(data.edge);
  const host = $derived(data.host);
  const basePath = $derived(`/app/memories/${data.graph.id}`);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  // Endpoint URNs, composed like the Nodes list (memory urn + loc). Source is
  // the host node (this memory); target carries its own memory urn (#350).
  function nodeUrn(memUrn: string | undefined, loc: string): string {
    return memUrn && loc ? composeNodeUrn(memUrn, loc) : loc;
  }
  const sourceUrn = $derived(nodeUrn(host.memory?.urn ?? data.graph.urn, host.loc));
  const targetUrn = $derived(nodeUrn(edge.target.memory?.urn ?? data.graph.urn, edge.target.loc));

  // ── Editable state (seeded from the loaded edge) ─────────────────────────
  // deserialize() can fail for JSONLogic shapes the structured ConditionBuilder
  // can't represent. On failure we keep the raw value, show it read-only, and
  // preserve it verbatim on save — letting the empty builder serialize over it
  // would silently clear the condition (#350 review).
  function seedCondition(e: typeof edge): { ui: UiCondition; error: string | null } {
    const r = deserialize(e.condition);
    return r.ok ? { ui: r.ui, error: null } : { ui: null, error: r.reason };
  }

  // Seed once from the loaded edge (untrack — these are initial values; the
  // effect below reseeds when the edge changes). untrack also silences the
  // state_referenced_locally warning for reading the `edge` derived here.
  const seeded = untrack(() => seedCondition(edge));
  let name = $state(untrack(() => edge.name ?? ''));
  let description = $state(untrack(() => edge.description ?? ''));
  let isRunnable = $state(untrack(() => !!edge.isRunnable));
  let priority = $state(untrack(() => String(edge.priority ?? 0)));
  let condition = $state<UiCondition>(seeded.ui);
  let conditionError = $state<string | null>(seeded.error);
  let dataText = $state(untrack(() => (edge.data != null ? JSON.stringify(edge.data, null, 2) : '')));
  let confirmDelete = $state(false);

  // ── Flow routing (#478) ───────────────────────────────────────────────────
  // The walker only follows edges named `next` / `next.<index>[.<label>]`
  // (falling back to the loc-derived segment for unnamed edges). Authors
  // never type that grammar by hand: routing mode generates the name from
  // an order number + optional label.
  function seedRouting(e: typeof edge, sourceLoc: string) {
    const routingName = routingNameOf(e, sourceLoc);
    const routing = isRoutingName(routingName);
    const parsed = routing ? parseRoutingName(routingName) : { index: null, label: null };
    return {
      routing,
      indexText: parsed.index !== null ? String(parsed.index) : '',
      label: parsed.label ?? '',
    };
  }
  const seededRouting = untrack(() => seedRouting(edge, host.loc));
  let isRouting = $state(seededRouting.routing);
  let routingIndexText = $state(seededRouting.indexText);
  let routingLabel = $state(seededRouting.label);

  function setRouting(on: boolean) {
    isRouting = on;
    if (!on) return;
    if (isRoutingName(name)) {
      const parsed = parseRoutingName(name);
      routingIndexText = parsed.index !== null ? String(parsed.index) : '';
      routingLabel = parsed.label ?? '';
    } else if (routingIndexText.trim() === '') {
      routingIndexText = String(nextFreeRoutingIndex(host.outgoingEdges, host.loc));
      routingLabel = '';
    }
  }

  const routingIndexValid = $derived(
    routingIndexText.trim() === '' || /^\d+$/.test(routingIndexText.trim()),
  );
  const routingName = $derived(
    buildRoutingName(
      routingIndexValid && routingIndexText.trim() !== '' ? Number(routingIndexText.trim()) : null,
      routingLabel,
    ),
  );
  /** The name the form submits: generated in routing mode, free-text otherwise. */
  const effectiveName = $derived(isRouting ? routingName : name);

  // Live firing order among the source node's routing edges — the walker's
  // exact ordering (priority asc → numeric index → loc), with THIS edge's
  // unsaved name/priority/condition substituted so the panel previews what
  // saving would do.
  const firingOrder = $derived.by(() => {
    const priorityNum = Number(priority);
    const siblings = host.outgoingEdges.map((e) =>
      e.id === edge.id
        ? {
            ...e,
            name: effectiveName || null,
            priority: Number.isInteger(priorityNum) ? priorityNum : (e.priority ?? 0),
            condition: conditionError ? e.condition : serialize(condition),
          }
        : e,
    );
    return routingOrder(siblings, host.loc);
  });

  /** Plain-English summary of a sibling's stored JSONLogic condition. */
  function conditionSummary(cond: unknown): string {
    if (cond == null) return t('edge-editor.order.always', 'always fires');
    const r = deserialize(cond);
    if (!r.ok) return t('edge-editor.order.custom', 'custom condition');
    return describeCondition(r.ui) ?? t('edge-editor.order.always', 'always fires');
  }

  // Live preview of the condition being edited ("when confidence is greater
  // than 0.8"); null = no condition.
  const conditionPreview = $derived(conditionError ? null : describeCondition(condition));

  // The page component is reused across sibling edge URLs (same route id), so
  // reseed the form when the loaded edge changes — otherwise edits to one edge
  // would bleed into the next. Plain `let` (not $state): reading+writing a $state
  // tracker inside the effect would make it a dependency and double-run (#350
  // review). The effect's only reactive dep is edge.id.
  let seededFor = untrack(() => edge.id);
  $effect(() => {
    if (edge.id === seededFor) return;
    seededFor = edge.id;
    name = edge.name ?? '';
    description = edge.description ?? '';
    isRunnable = !!edge.isRunnable;
    priority = String(edge.priority ?? 0);
    const s = seedCondition(edge);
    condition = s.ui;
    conditionError = s.error;
    dataText = edge.data != null ? JSON.stringify(edge.data, null, 2) : '';
    confirmDelete = false;
    const r = seedRouting(edge, host.loc);
    isRouting = r.routing;
    routingIndexText = r.indexText;
    routingLabel = r.label;
  });

  // Hidden form field. When the condition couldn't be parsed into the builder,
  // submit the ORIGINAL JSONLogic unchanged (preserve); otherwise serialize the
  // builder. null = always fires → CLEAR on save. (Mirrors the conv. editor.)
  const conditionJson = $derived(
    conditionError ? JSON.stringify(edge.condition ?? null) : JSON.stringify(serialize(condition)),
  );

  // Client-side JSON validity hint for the data field (server re-validates).
  const dataTrimmed = $derived(dataText.trim());
  const dataValid = $derived.by(() => {
    if (dataTrimmed === '') return true; // empty clears
    try {
      JSON.parse(dataTrimmed);
      return true;
    } catch {
      return false;
    }
  });
</script>

<svelte:head><title>Edge · {host.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: data.graph.name, href: basePath },
    { label: host.name, href: `${basePath}/nodes/${host.id}` },
    { label: 'Edge' },
  ]} />

  <!-- Header -->
  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">
      <span class="font-normal text-zinc-400">Edge:</span> {edge.name || edge.loc}
    </h1>
    <p class="mt-1 font-mono text-xs text-zinc-500">{edge.loc}</p>
  </div>

  <!-- Endpoints -->
  <section class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
    <div class="grid gap-4 sm:grid-cols-2">
      <div class="min-w-0">
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Source</p>
        <a href="{basePath}/nodes/{host.id}" class="block truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{host.name}</a>
        <div class="mt-0.5"><Urn value={sourceUrn} type="node" size={10} /></div>
      </div>
      <div class="min-w-0">
        <p class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Target</p>
        <a href="{basePath}/nodes/{edge.target.id}" class="block truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{edge.target.name || edge.target.loc}</a>
        <div class="mt-0.5"><Urn value={targetUrn} type="node" size={10} /></div>
      </div>
    </div>
  </section>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.saved}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Edge saved.</div>
  {/if}

  <!-- Edit form -->
  <form method="POST" action="?/update" use:enhance class="max-w-2xl space-y-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
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
      <p class="mt-1 text-xs text-zinc-400">
        {t(
          'edge-editor.routing.explainer',
          'Routing edges decide where a flow goes next after this node runs. Reference edges (like “documents”) instead inline the target’s content into the node’s prompt — they never route.',
        )}
      </p>
    </div>

    {#if isRouting}
      <div class="flex flex-wrap items-start gap-4">
        <div class="w-28">
          <label for="routingOrder" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('edge-editor.routing.order', 'Order')}
          </label>
          <input
            id="routingOrder"
            type="number"
            min="0"
            step="1"
            bind:value={routingIndexText}
            class={inputClass}
          />
          <p class="mt-1 text-xs {routingIndexValid ? 'text-zinc-400' : 'text-red-500'}">
            {routingIndexValid
              ? t('edge-editor.routing.order.hint', 'Checked first = lowest.')
              : t('edge-editor.routing.order.invalid', 'Must be a whole number.')}
          </p>
        </div>
        <div class="min-w-[12rem] flex-1">
          <label for="routingLabel" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {t('edge-editor.routing.label', 'Label (optional)')}
          </label>
          <input
            id="routingLabel"
            type="text"
            bind:value={routingLabel}
            placeholder={t('edge-editor.routing.label.placeholder', 'e.g. high confidence')}
            class={inputClass}
          />
          <p class="mt-1 text-xs text-zinc-400">
            {t('edge-editor.routing.generated', 'Saved as')}
            <span class="font-mono text-zinc-500 dark:text-zinc-300">{routingName}</span>
          </p>
        </div>
      </div>
      <input type="hidden" name="name" value={routingName} />
    {:else}
      <div>
        <label for="edgeName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Relationship name</label>
        <input id="edgeName" name="name" type="text" bind:value={name} placeholder="e.g. cites, depends_on" class={inputClass} />
        <p class="mt-1 text-xs text-zinc-400">Optional free-form label. The edge's identity is its <span class="font-mono">loc</span> ({edge.loc}), which isn't editable here.</p>
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

    <div>
      <label for="edgeDescription" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
      <textarea id="edgeDescription" name="description" rows="2" bind:value={description} placeholder="What this relationship means" class={inputClass}></textarea>
    </div>

    <div class="flex flex-wrap items-end gap-6">
      <div class="w-32">
        <label for="edgePriority" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Priority</label>
        <input id="edgePriority" name="priority" type="number" step="1" bind:value={priority} class={inputClass} />
        <p class="mt-1 text-xs text-zinc-400">Lower = earlier.</p>
      </div>
      <label class="flex items-center gap-2 pb-2 text-sm text-zinc-700 dark:text-zinc-300">
        <input type="checkbox" name="isRunnable" value="true" bind:checked={isRunnable}
          class="rounded border-zinc-300 text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
        Runnable
      </label>
    </div>

    <div>
      <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Condition</span>
      <p class="mb-2 text-xs text-zinc-400">JSONLogic gate — when it evaluates false the edge doesn't fire. Empty = always fires.</p>
      {#if conditionError}
        <!-- The stored condition uses a shape the visual builder can't represent.
             Show it read-only and preserve it verbatim on save (conditionJson
             submits the original) so it can't be silently overwritten. -->
        <div class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          This condition uses an expression the visual builder can't edit ({conditionError}). It's shown read-only and will be preserved unchanged when you save.
        </div>
        <pre class="mt-2 overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-xs text-zinc-700 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{JSON.stringify(edge.condition, null, 2)}</pre>
      {:else}
        <ConditionBuilder bind:value={condition} extraVariables={data.flowFields} />
      {/if}
      <input type="hidden" name="condition" value={conditionJson} />
      {#if !conditionError}
        <p class="mt-2 text-xs italic text-zinc-500 dark:text-zinc-400">
          {#if conditionPreview}
            {t('edge-editor.preview.fires', 'Fires')} {conditionPreview}.
          {:else if isRouting}
            {t('edge-editor.preview.fall-through', 'Always fires — the fall-through branch.')}
          {/if}
        </p>
      {/if}
    </div>

    <div>
      <label for="edgeData" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Data (JSON)</label>
      <textarea id="edgeData" name="data" rows="6" bind:value={dataText} placeholder="{'{ }'}"
        class="w-full rounded-lg border bg-zinc-50 p-3 font-mono text-xs text-zinc-800 focus:outline-none dark:bg-zinc-950 dark:text-zinc-300 {dataValid ? 'border-zinc-200 focus:border-indigo-500 dark:border-zinc-800' : 'border-red-400 focus:border-red-500 dark:border-red-700'}"></textarea>
      <p class="mt-1 text-xs {dataValid ? 'text-zinc-400' : 'text-red-500'}">
        {dataValid ? 'Free-form JSON payload. Leave empty to clear.' : 'Invalid JSON.'}
      </p>
    </div>

    <div class="flex items-center gap-3">
      <button type="submit" disabled={!dataValid || (isRouting && !routingIndexValid)} class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style="background: #fb8500;">
        Save edge
      </button>
      <a href="{basePath}/nodes/{host.id}" class="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">Back to node</a>
    </div>
  </form>

  <!-- Effective firing order among this node's routing edges (#478). Reflects
       unsaved edits to THIS edge so authors preview what saving will do. -->
  {#if firingOrder.length > 0}
    <section class="max-w-2xl rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">
        {t('edge-editor.order.title', 'Flow routing from')} “{host.name}”
      </h3>
      <p class="mt-1 text-xs text-zinc-400">
        {t(
          'edge-editor.order.explainer',
          'After this node runs, branches are checked top to bottom; the first one whose condition passes is followed. If none fires, the flow ends here.',
        )}
      </p>
      <ol class="mt-3 space-y-2">
        {#each firingOrder as entry (entry.edge.id)}
          {@const isCurrent = entry.edge.id === edge.id}
          <li
            class="flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border px-3 py-2 text-sm
              {isCurrent
              ? 'border-indigo-300 bg-indigo-50 dark:border-indigo-800 dark:bg-indigo-950/40'
              : 'border-zinc-200 dark:border-zinc-800'}
              {entry.isUnreachable ? 'opacity-60' : ''}"
          >
            <span class="font-mono text-xs text-zinc-400">{entry.position}.</span>
            <span class="font-mono text-xs text-zinc-600 dark:text-zinc-300">{entry.routingName}</span>
            <span class="text-zinc-400">→</span>
            <span class="font-medium text-zinc-800 dark:text-zinc-100">
              {entry.edge.target.name || entry.edge.target.loc}
            </span>
            {#if (entry.edge.priority ?? 0) !== 0}
              <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {t('edge-editor.order.priority', 'priority')} {entry.edge.priority}
              </span>
            {/if}
            {#if isCurrent}
              <span class="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-200">
                {t('edge-editor.order.this-edge', 'this edge')}
              </span>
            {/if}
            <span class="basis-full text-xs italic text-zinc-500 dark:text-zinc-400">
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
    </section>
  {/if}

  <!-- Danger zone -->
  <section class="max-w-2xl">
    <h3 class="mb-2 text-sm font-semibold text-red-500">Danger zone</h3>
    {#if !confirmDelete}
      <button type="button" onclick={() => (confirmDelete = true)} class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
        Delete edge
      </button>
    {:else}
      <form method="POST" action="?/delete" use:enhance class="flex items-center gap-2">
        <span class="text-sm text-red-500">Delete this edge? This cannot be undone.</span>
        <button type="submit" class="rounded-md bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-500">Yes, delete</button>
        <button type="button" onclick={() => (confirmDelete = false)} class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
      </form>
    {/if}
  </section>
</div>
