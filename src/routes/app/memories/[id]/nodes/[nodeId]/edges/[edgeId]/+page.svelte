<script lang="ts">
  import { enhance } from '$app/forms';
  import { untrack } from 'svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import ConditionBuilder from '$lib/edge-conditions/ConditionBuilder.svelte';
  import { serialize, deserialize } from '$lib/edge-conditions/serializer';
  import type { UiCondition } from '$lib/edge-conditions/types';
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
  function initialCondition(e: typeof edge): UiCondition {
    const r = deserialize(e.condition);
    return r.ok ? r.ui : null;
  }

  // Seed once from the loaded edge (untrack — these are initial values; the
  // effect below reseeds when the edge changes). untrack also silences the
  // state_referenced_locally warning for reading the `edge` derived here.
  let name = $state(untrack(() => edge.name ?? ''));
  let description = $state(untrack(() => edge.description ?? ''));
  let isRunnable = $state(untrack(() => !!edge.isRunnable));
  let priority = $state(untrack(() => String(edge.priority ?? 0)));
  let condition = $state<UiCondition>(untrack(() => initialCondition(edge)));
  let dataText = $state(untrack(() => (edge.data != null ? JSON.stringify(edge.data, null, 2) : '')));
  let confirmDelete = $state(false);

  // The page component is reused across sibling edge URLs (same route id), so
  // reseed the form when the loaded edge changes — otherwise edits to one edge
  // would bleed into the next. Tracks edge.id only; the reseed runs the rest.
  let seededFor = $state(untrack(() => edge.id));
  $effect(() => {
    if (edge.id === seededFor) return;
    seededFor = edge.id;
    name = edge.name ?? '';
    description = edge.description ?? '';
    isRunnable = !!edge.isRunnable;
    priority = String(edge.priority ?? 0);
    condition = initialCondition(edge);
    dataText = edge.data != null ? JSON.stringify(edge.data, null, 2) : '';
    confirmDelete = false;
  });

  // Serialize the structured condition to JSONLogic for the hidden form field
  // (mirrors the conversation editor). null = always fires → CLEAR on save.
  const conditionJson = $derived(JSON.stringify(serialize(condition)));

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
      <label for="edgeName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Relationship name</label>
      <input id="edgeName" name="name" type="text" bind:value={name} placeholder="e.g. cites, depends_on" class={inputClass} />
      <p class="mt-1 text-xs text-zinc-400">Optional free-form label. The edge's identity is its <span class="font-mono">loc</span> ({edge.loc}), which isn't editable here.</p>
    </div>

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
      <ConditionBuilder bind:value={condition} />
      <input type="hidden" name="condition" value={conditionJson} />
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
      <button type="submit" disabled={!dataValid} class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" style="background: #fb8500;">
        Save edge
      </button>
      <a href="{basePath}/nodes/{host.id}" class="text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">Back to node</a>
    </div>
  </form>

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
