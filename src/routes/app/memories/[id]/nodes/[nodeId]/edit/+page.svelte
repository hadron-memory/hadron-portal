<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import PropertiesEditor from '$lib/components/PropertiesEditor.svelte';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import { declaredObjectType, objectTypeNames, readMemorySchema } from '$lib/schema/memory-schema';
  import type { PageData, ActionData } from './$types';
  import { editNodeSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const node = $derived(data.node);
  const basePath = $derived(`/app/memories/${data.graph.id}`);
  const initialForm = untrack(() => form?.form ?? data.form);
  const {
    form: formData,
    errors,
    constraints,
    message,
    submitting,
    enhance,
  } = superForm(initialForm, {
    validators: zod4Client(editNodeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  const nameError = $derived($errors.name?.[0] ?? null);
  const locError = $derived($errors.loc?.[0] ?? null);
  const actionError = $derived($message?.type === 'error' ? $message.text : null);

  // #588 (server #725): structured storage. With a memory schema, objectType
  // is a picker over the declared collections; without one it's free text.
  // A pre-schema node may carry an objectType that is no longer declared —
  // keep it selectable (marked) so the bound value isn't orphaned.
  const memorySchema = $derived(readMemorySchema(data.graph.schema));
  const collectionNames = $derived(objectTypeNames(memorySchema));
  const declaredCollection = $derived(declaredObjectType(memorySchema, $formData.objectType || null));
  const undeclaredCurrent = $derived(
    $formData.objectType && !collectionNames.includes($formData.objectType) ? $formData.objectType : null,
  );
  const propertiesError = $derived($errors.propertiesJson?.[0] ?? null);
  let propertiesInvalid = $state(false);

  const ABSTRACT_MAX = 2000;

  function parseEdges(value: string): Array<{ targetId: string; name: string }> {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((edge): edge is { targetId: string; name: string } => (
            edge &&
            typeof edge === 'object' &&
            typeof edge.targetId === 'string' &&
            typeof edge.name === 'string'
          ))
        : [];
    } catch {
      return [];
    }
  }

  // Edge management
  let edges: Array<{ targetId: string; name: string }> = $state(
    untrack(() => parseEdges(initialForm.data.edges)),
  );
  let newTargetLoc = $state('');
  let newLabel = $state('');

  $effect(() => {
    formData.update((current) => ({
      ...current,
      edges: JSON.stringify(edges),
    }), { taint: false });
  });

  function addEdge() {
    if (newTargetLoc.trim()) {
      edges = [...edges, { targetId: newTargetLoc.trim(), name: newLabel.trim() }];
      newTargetLoc = '';
      newLabel = '';
    }
  }

  function removeEdge(index: number) {
    edges = edges.filter((_, i) => i !== index);
  }
</script>

<svelte:head><title>Edit &middot; {node.loc} &middot; Hadron</title></svelte:head>

<div class="max-w-3xl space-y-6">
  <div class="flex items-center gap-3">
    <a href="{basePath}/nodes/{node.id}" class="text-sm text-indigo-500 hover:underline dark:text-indigo-400">&larr; Back to node</a>
    <h1 class="font-mono text-lg font-bold text-zinc-900 dark:text-white">{node.loc}</h1>
  </div>

  {#if actionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
  {/if}

  <form method="POST" use:enhance class="space-y-6" novalidate>
    <!-- Metadata -->
    <section class="space-y-4">
      <h2 class="border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">Metadata</h2>

      <div>
        <label for="name" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Name</label>
        <input
          id="name"
          name="name"
          type="text"
          bind:value={$formData.name}
          aria-invalid={!!nameError}
          aria-describedby={nameError ? 'nameError' : undefined}
          {...$constraints.name}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none {nameError ? 'border-red-500 focus:border-red-500' : ''}"
        />
        {#if nameError}
          <p id="nameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{nameError}</p>
        {/if}
      </div>

      <div>
        <label for="loc" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Loc <span class="text-zinc-500">(colon-delimited path — changing this moves the node)</span></label>
        <input
          id="loc"
          name="loc"
          type="text"
          bind:value={$formData.loc}
          aria-invalid={!!locError}
          aria-describedby={locError ? 'locError' : undefined}
          {...$constraints.loc}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white focus:border-indigo-500 focus:outline-none {locError ? 'border-red-500 focus:border-red-500' : ''}"
        />
        {#if locError}
          <p id="locError" class="mt-1 text-xs text-red-600 dark:text-red-400">{locError}</p>
        {/if}
      </div>

      <div>
        <label for="description" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Description</label>
        <textarea id="description" name="description" rows="3" bind:value={$formData.description}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none"></textarea>
      </div>

      <div>
        <label for="alias" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Alias</label>
        <input id="alias" name="alias" type="text" bind:value={$formData.alias} placeholder="Optional"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>

      <div>
        <label for="seq" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Seq <span class="text-zinc-500">(sort order among siblings)</span></label>
        <input id="seq" name="seq" type="number" bind:value={$formData.seq} placeholder="Optional"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>

      <div>
        <label for="tags" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">Tags <span class="text-zinc-500">(comma-separated)</span></label>
        <input id="tags" name="tags" type="text" bind:value={$formData.tags}
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none" />
      </div>

      <div>
        <label class="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
          <input name="isRunnable" type="checkbox" value="true" bind:checked={$formData.isRunnable}
            class="h-4 w-4 rounded border-zinc-300 text-indigo-600 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-900" />
          Is Runnable <span class="text-zinc-500">(can be run as a task by hadron_run_task)</span>
        </label>
      </div>
    </section>

    <!-- #588 (server #725): collection discriminator + typed properties. -->
    <section class="space-y-4">
      <h2 class="border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">Structured storage</h2>

      <div>
        <label for="objectType" class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">{createNodeStrings.fieldObjectType()}</label>
        {#if collectionNames.length > 0 || undeclaredCurrent}
          <select id="objectType" name="objectType" bind:value={$formData.objectType}
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none">
            <option value="">{createNodeStrings.objectTypeNone()}</option>
            {#each collectionNames as name (name)}
              <option value={name}>{name}</option>
            {/each}
            {#if undeclaredCurrent}
              <option value={undeclaredCurrent}>{undeclaredCurrent} (not declared)</option>
            {/if}
          </select>
          <p class="mt-1 text-xs text-zinc-500">{createNodeStrings.objectTypeHintDeclared()}</p>
        {:else}
          <input id="objectType" name="objectType" type="text" bind:value={$formData.objectType}
            placeholder="e.g. competitor"
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
          <p class="mt-1 text-xs text-zinc-500">{createNodeStrings.objectTypeHintFreeform()}</p>
        {/if}
      </div>

      <div>
        <span class="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">{createNodeStrings.fieldProperties()}</span>
        <input type="hidden" name="propertiesJson" value={$formData.propertiesJson} />
        <!-- Re-mount on objectType change so typed field state re-seeds. -->
        {#key $formData.objectType}
          <PropertiesEditor
            declared={declaredCollection}
            bind:value={$formData.propertiesJson}
            bind:invalid={propertiesInvalid}
          />
        {/key}
        {#if propertiesError}
          <p class="mt-1 text-xs text-red-600 dark:text-red-400">{propertiesError}</p>
        {/if}
      </div>
    </section>

    <!-- Edges (was “References” — #490) -->
    <section class="space-y-3">
      <h2 class="border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">Edges</h2>
      <input type="hidden" name="edges" value={$formData.edges} />
      {#if edges.length > 0}
        <div class="space-y-1">
          {#each edges as edge, i}
            <div class="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
              <span class="font-mono text-indigo-400">{edge.targetId}</span>
              <span class="text-zinc-500">{edge.name}</span>
              <button type="button" class="ml-auto text-red-400 hover:text-red-300" onclick={() => removeEdge(i)}>&times;</button>
            </div>
          {/each}
        </div>
      {/if}
      <div class="flex gap-2">
        <input type="text" placeholder="target ID" bind:value={newTargetLoc}
          class="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
        <input type="text" placeholder="label" bind:value={newLabel}
          class="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
        <button type="button" onclick={addEdge}
          class="rounded-lg border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-700">Add</button>
      </div>
    </section>

    <!-- Abstract -->
    <section class="space-y-3">
      <h2 class="border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">Abstract</h2>
      <textarea name="abstract" bind:value={$formData.abstract} maxlength={ABSTRACT_MAX}
        placeholder="Paragraph-length summary — the default source for vector search."
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
        style="min-height: 120px; resize: vertical;"></textarea>
      <div class="text-right text-xs {$formData.abstract.length > ABSTRACT_MAX ? 'text-red-500' : 'text-zinc-500'}">{$formData.abstract.length} / {ABSTRACT_MAX}</div>
    </section>

    <!-- Content -->
    <section class="space-y-3">
      <h2 class="border-b border-zinc-200 pb-2 text-sm font-semibold uppercase tracking-wide text-zinc-700 dark:border-zinc-800 dark:text-zinc-300">Content</h2>
      <textarea name="content" bind:value={$formData.content}
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white focus:border-indigo-500 focus:outline-none"
        style="min-height: 400px; resize: vertical;"></textarea>
    </section>

    <!-- Actions -->
    <div class="flex items-center gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
      <button
        type="submit"
        disabled={$submitting || propertiesInvalid}
        class="rounded-lg bg-amber-500 px-6 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {$submitting ? 'Saving...' : 'Save'}
      </button>
      <a href="{basePath}/nodes/{node.id}" class="text-sm text-zinc-500 hover:text-zinc-300">Cancel</a>
    </div>
  </form>
</div>
