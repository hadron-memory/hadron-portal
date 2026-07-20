<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import PropertiesEditor from '$lib/components/PropertiesEditor.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { declaredObjectType, objectTypeNames, readMemorySchema } from '$lib/schema/memory-schema';
  import { deriveDefaultLoc } from '$lib/create-node/derive-default-loc';
  import { composeNodeUrn } from '$lib/urn/compose-node-urn';
  import { cleanLocInput } from '$lib/urn/clean-loc-input';
  import { createNodeStrings } from '$lib/i18n/create-node-strings';
  import type { PageData, ActionData } from './$types';
  import { createNodeSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const memory = $derived(data.graph);
  const parentLoc = $derived(data.parentLoc);
  const existingLocs = $derived(data.existingLocs);
  const initialForm = untrack(() => form?.form ?? data.form);
  const {
    form: formData,
    errors,
    constraints,
    message,
    submitting,
    enhance,
  } = superForm(initialForm, {
    validators: zod4Client(createNodeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // #260: org-less memory route. The owning-org crumbs are only included when
  // the user is a member of that org (org present); a non-member contributor
  // gets a leaner trail that starts at the memory.
  const breadcrumbItems = $derived([
    { href: '/app/dashboard', label: 'Dashboard' },
    ...(data.org
      ? [
          { href: `/app/orgs/${data.org.id}`, label: data.org.name },
          { href: `/app/orgs/${data.org.id}/memories`, label: 'Memories' },
        ]
      : []),
    { href: `/app/memories/${memory.id}`, label: memory.name },
    { label: 'New node' },
  ]);

  // #320: a command-bar deep-link prefills the full loc; treat it as
  // manually-edited so name-derivation doesn't clobber it. untrack snapshots
  // the seed once (data won't change without a reload).
  let locManuallyEdited = $state(untrack(() => !!data.prefillLoc || !!form?.form));

  const ABSTRACT_MAX = 2000;
  let showAdvancedTypes = $state(untrack(() => initialForm.data.nodeType === 'system' || initialForm.data.nodeType === 'reference'));
  const nameError = $derived($errors.name?.[0] ?? null);
  const locError = $derived($errors.loc?.[0] ?? null);
  const nodeTypeError = $derived($errors.nodeType?.[0] ?? null);
  const actionError = $derived($message?.type === 'error' ? $message.text : null);

  // #588 (server #725): structured storage. With a memory schema, objectType
  // is a picker over the declared collections (an undeclared value would be
  // rejected server-side); without one it's free text. When the chosen
  // objectType names a declared collection, PropertiesEditor renders typed
  // fields; otherwise a free-form JSON editor.
  const memorySchema = $derived(readMemorySchema(memory.schema));
  const collectionNames = $derived(objectTypeNames(memorySchema));
  const declaredCollection = $derived(declaredObjectType(memorySchema, $formData.objectType || null));
  const propertiesError = $derived($errors.propertiesJson?.[0] ?? null);
  let propertiesInvalid = $state(false);

  // Auto-derive loc from name until the user manually edits the loc field.
  // Once they do, name changes don't overwrite their choice. The loc field
  // shows the FULL path (parent:leaf) so the user has one editable string
  // that maps 1:1 to what gets submitted — no hidden composition.
  $effect(() => {
    if (locManuallyEdited) return;
    const nextLoc = $formData.name
      ? `${parentLoc ? `${parentLoc}:` : ''}${deriveDefaultLoc($formData.name, parentLoc, existingLocs)}`
      : '';
    formData.update((current) => (
      current.loc === nextLoc ? current : { ...current, loc: nextLoc }
    ), { taint: false });
  });

  // URN preview uses the SAME normalization the server action runs
  // (cleanLocInput) so the preview can't lie about what gets created.
  // Only render when both inputs are populated (R-1/R-2 pattern from
  // spec 010: composeNodeUrn throws on empty inputs).
  const submittedLoc = $derived(cleanLocInput($formData.loc));
  const previewUrn = $derived(
    memory.urn && submittedLoc ? composeNodeUrn(memory.urn, submittedLoc) : '',
  );

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  function onLocInput(e: Event) {
    locManuallyEdited = true;
  }

  // Toggling "advanced types" OFF while system/reference is selected
  // would orphan the value (the <option> is removed from the DOM but
  // the bound value persists, leading to a hidden submit). Reset to
  // 'info' so the dropdown stays in sync with the visible options.
  $effect(() => {
    if (!showAdvancedTypes && ($formData.nodeType === 'system' || $formData.nodeType === 'reference')) {
      formData.update((current) => ({ ...current, nodeType: 'info' }), { taint: false });
    }
  });
</script>

<div class="mx-auto max-w-2xl space-y-4 p-4">
  <Breadcrumb items={breadcrumbItems} />

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

  {#if actionError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
      {actionError}
    </div>
  {/if}

  <form method="POST" use:enhance class="space-y-4" novalidate>
    <div>
      <label for="name" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldName()}
      </label>
      <input
        id="name"
        name="name"
        type="text"
        required
        bind:value={$formData.name}
        aria-invalid={!!nameError}
        aria-describedby={nameError ? 'nameError' : undefined}
        {...$constraints.name}
        class="{inputClass} {nameError ? 'border-red-500 focus:border-red-500' : ''}"
        placeholder="e.g. Sort imports"
      />
      {#if nameError}
        <p id="nameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{nameError}</p>
      {/if}
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
        bind:value={$formData.loc}
        oninput={onLocInput}
        aria-invalid={!!locError}
        aria-describedby={locError ? 'locError locHint' : 'locHint'}
        {...$constraints.loc}
        class="{inputClass} {locError ? 'border-red-500 focus:border-red-500' : ''}"
        placeholder="e.g. sort-imports"
      />
      <p id="locHint" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.locHint()}
      </p>
      {#if locError}
        <p id="locError" class="mt-1 text-xs text-red-600 dark:text-red-400">{locError}</p>
      {/if}
    </div>

    <div>
      <label for="nodeType" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldNodeType()}
      </label>
      <select
        id="nodeType"
        name="nodeType"
        bind:value={$formData.nodeType}
        aria-invalid={!!nodeTypeError}
        aria-describedby={nodeTypeError ? 'nodeTypeError' : undefined}
        {...$constraints.nodeType}
        class="{inputClass} {nodeTypeError ? 'border-red-500 focus:border-red-500' : ''}"
      >
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
      {#if nodeTypeError}
        <p id="nodeTypeError" class="mt-1 text-xs text-red-600 dark:text-red-400">{nodeTypeError}</p>
      {/if}
    </div>

    <!-- #588 (server #725): collection discriminator + typed properties. -->
    <div>
      <label for="objectType" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldObjectType()}
      </label>
      {#if collectionNames.length > 0}
        <select id="objectType" name="objectType" bind:value={$formData.objectType} class={inputClass}>
          <option value="">{createNodeStrings.objectTypeNone()}</option>
          {#each collectionNames as name (name)}
            <option value={name}>{name}</option>
          {/each}
        </select>
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{createNodeStrings.objectTypeHintDeclared()}</p>
      {:else}
        <input id="objectType" name="objectType" type="text" bind:value={$formData.objectType}
          placeholder="e.g. competitor" class={inputClass} />
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{createNodeStrings.objectTypeHintFreeform()}</p>
      {/if}
    </div>

    {#if $formData.objectType}
      <div>
        <span class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">{createNodeStrings.fieldProperties()}</span>
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
    {/if}

    <div>
      <label for="description" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldDescription()}
      </label>
      <input id="description" name="description" type="text" bind:value={$formData.description} class={inputClass} />
    </div>

    <div>
      <label for="abstract" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldAbstract()}
      </label>
      <textarea id="abstract" name="abstract" rows="3" bind:value={$formData.abstract} maxlength={ABSTRACT_MAX}
        placeholder="Paragraph-length summary — the default source for vector search."
        class={inputClass}></textarea>
      <p class="mt-1 text-right text-xs {$formData.abstract.length > ABSTRACT_MAX ? 'text-red-500' : 'text-zinc-500 dark:text-zinc-400'}">{$formData.abstract.length} / {ABSTRACT_MAX}</p>
    </div>

    <div>
      <label for="content" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldContent()}
      </label>
      <textarea id="content" name="content" rows="6" bind:value={$formData.content} class={inputClass}></textarea>
    </div>

    {#if previewUrn}
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/50">
        <p class="mb-1 text-xs text-zinc-500 dark:text-zinc-400">Will be created at:</p>
        <Urn value={previewUrn} type="node" />
      </div>
    {/if}

    <div class="flex items-center justify-end gap-2">
      <a
        href="/app/memories/{memory.id}"
        class="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Cancel
      </a>
      <button
        type="submit"
        disabled={$submitting || !$formData.name.trim() || !$formData.loc.trim() || propertiesInvalid}
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {$submitting ? createNodeStrings.submitting() : createNodeStrings.submit()}
      </button>
    </div>
  </form>
</div>
