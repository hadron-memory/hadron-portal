<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { deriveDefaultLoc } from '$lib/create-node/derive-default-loc';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import { cleanLocInput } from '$lib/urn/clean-loc-input';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const memory = $derived(data.graph);
  const parentLoc = $derived(data.parentLoc);
  const existingLocs = $derived(data.existingLocs);

  let name = $state('');
  let loc = $state('');
  let locManuallyEdited = $state(false);
  let nodeType = $state<'info' | 'record' | 'system' | 'reference'>('info');
  let description = $state('');
  let content = $state('');
  let showAdvancedTypes = $state(false);
  let saving = $state(false);

  // Auto-derive loc from name until the user manually edits the loc field.
  // Once they do, name changes don't overwrite their choice. The loc field
  // shows the FULL path (parent:leaf) so the user has one editable string
  // that maps 1:1 to what gets submitted — no hidden composition.
  $effect(() => {
    if (locManuallyEdited) return;
    if (!name) {
      loc = '';
      return;
    }
    const leaf = deriveDefaultLoc(name, parentLoc, existingLocs);
    loc = parentLoc ? `${parentLoc}:${leaf}` : leaf;
  });

  // URN preview uses the SAME normalization the server action runs
  // (cleanLocInput) so the preview can't lie about what gets created.
  // Only render when both inputs are populated (R-1/R-2 pattern from
  // spec 010: composeNodeUrn throws on empty inputs).
  const submittedLoc = $derived(cleanLocInput(loc));
  const previewUrn = $derived(
    memory.urn && submittedLoc ? composeNodeUrn(memory.urn, submittedLoc) : '',
  );

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  function onLocInput(e: Event) {
    locManuallyEdited = true;
    loc = (e.target as HTMLInputElement).value;
  }

  // Toggling "advanced types" OFF while system/reference is selected
  // would orphan the value (the <option> is removed from the DOM but
  // the bound value persists, leading to a hidden submit). Reset to
  // 'info' so the dropdown stays in sync with the visible options.
  $effect(() => {
    if (!showAdvancedTypes && (nodeType === 'system' || nodeType === 'reference')) {
      nodeType = 'info';
    }
  });

  function savingEnhance(formEl: HTMLFormElement) {
    return enhance(formEl, () => {
      saving = true;
      return async ({ update }) => {
        saving = false;
        await update();
      };
    });
  }
</script>

<div class="mx-auto max-w-2xl space-y-4 p-4">
  <Breadcrumb
    items={[
      { href: '/app/dashboard', label: 'Dashboard' },
      { href: `/app/orgs/${data.org.id}`, label: data.org.name },
      { href: `/app/orgs/${data.org.id}/memories`, label: 'Memories' },
      { href: `/app/orgs/${data.org.id}/memories/${memory.id}`, label: memory.name },
      { label: 'New node' },
    ]}
  />

  <div>
    <h1 class="text-xl font-semibold text-zinc-900 dark:text-white">
      New node in <span class="font-normal">{memory.name}</span>
    </h1>
    {#if parentLoc}
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Adding under parent: <code class="font-mono text-xs">{parentLoc}</code>
      </p>
    {/if}
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
      {form.error}
    </div>
  {/if}

  <form method="POST" use:savingEnhance class="space-y-4">
    <div>
      <label for="name" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldName()}
      </label>
      <input
        id="name"
        name="name"
        type="text"
        required
        bind:value={name}
        class={inputClass}
        placeholder="e.g. Sort imports"
      />
    </div>

    <div>
      <label for="loc" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldLoc()}
      </label>
      <input
        id="loc"
        name="loc"
        type="text"
        required
        value={loc}
        oninput={onLocInput}
        class={inputClass}
        placeholder="e.g. sort-imports"
      />
      <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.locHint()}
      </p>
    </div>

    <div>
      <label for="nodeType" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldNodeType()}
      </label>
      <select id="nodeType" name="nodeType" bind:value={nodeType} class={inputClass}>
        <option value="info">info</option>
        <option value="record">record</option>
        {#if showAdvancedTypes}
          <option value="system">system</option>
          <option value="reference">reference</option>
        {/if}
      </select>
      <label class="mt-1 inline-flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
        <input type="checkbox" bind:checked={showAdvancedTypes} class="h-3 w-3" />
        {createNodeStrings.advancedToggle()}
      </label>
    </div>

    <div>
      <label for="description" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldDescription()}
      </label>
      <input id="description" name="description" type="text" bind:value={description} class={inputClass} />
    </div>

    <div>
      <label for="content" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldContent()}
      </label>
      <textarea id="content" name="content" rows="6" bind:value={content} class={inputClass}></textarea>
    </div>

    {#if previewUrn}
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <p class="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Will be created at:</p>
        <Urn value={previewUrn} type="node" />
      </div>
    {/if}

    <div class="flex items-center justify-end gap-2">
      <a
        href="/app/orgs/{data.org.id}/memories/{memory.id}"
        class="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Cancel
      </a>
      <button
        type="submit"
        disabled={saving || !name.trim() || !loc.trim()}
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {saving ? createNodeStrings.submitting() : createNodeStrings.submit()}
      </button>
    </div>
  </form>
</div>
