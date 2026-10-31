<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { abstractPlaceholder, abstractSearchHint } from '$lib/abstract-search-hint';
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
  const abstractHint = $derived(abstractSearchHint(memory));
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
    // The submit button is aria-disabled (not natively `disabled`) so it stays
    // focusable and its disabled-reason is announced (#622 a11y review). Since
    // an aria-disabled button can still be activated, cancel the submit here
    // when the form isn't ready. (`submitDisabledReason` is declared below; this
    // closure only reads it at submit time.)
    onSubmit: ({ cancel }) => {
      if (submitDisabledReason) cancel();
    },
  });

  // Match the node detail trail, including memories without an org link.
  const breadcrumbItems = $derived([
    { href: data.org ? `/app/orgs/${data.org.id}/memories` : undefined, label: t('node.new.memories', 'Memories') },
    { href: `/app/memories/${memory.id}`, label: memory.name },
    { href: `/app/memories/${memory.id}/nodes`, label: t('node.new.nodes', 'Nodes') },
    { label: t('node.new.title', 'New node') },
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

  // #622: the Properties section (and its editor) only renders when an
  // objectType is chosen. `propertiesInvalid` is bound from PropertiesEditor,
  // which UNMOUNTS when the user clears objectType back to "None" — leaving the
  // flag stuck at its last value (e.g. `true` from a declared collection's
  // required field). Gate the properties concern on objectType so a hidden
  // editor can never block submit with no visible field to fix.
  const propertiesBlockSubmit = $derived(
    !!$formData.objectType && (propertiesInvalid || !!propertiesError),
  );

  // #622: never present a disabled submit button with no explanation. When the
  // button is held disabled (and we're not mid-submit, where the spinner speaks
  // for itself), surface the first unmet requirement next to it.
  const submitDisabledReason = $derived.by(() => {
    if (data.canWriteMemory === false) return t('memory-detail.read-only', 'Read only — editing is unavailable for this memory.');
    if (!$formData.name.trim()) return createNodeStrings.disabledReasonName();
    if (!$formData.loc.trim()) return createNodeStrings.disabledReasonLoc();
    if (propertiesBlockSubmit) return createNodeStrings.disabledReasonProperties();
    return null;
  });

  // Auto-derive loc from name until the user manually edits the loc field.
  // Once they do, name changes don't overwrite their choice. The loc field
  // shows the FULL path (parent:leaf) so the user has one editable string
  // that maps 1:1 to what gets submitted — no hidden composition.
  $effect(() => {
    if (locManuallyEdited) return;
    const nextLoc = $formData.name
      ? `${parentLoc ? `${parentLoc}:` : ''}${deriveDefaultLoc($formData.name, parentLoc, existingLocs)}`
      : '';
    // Guard the update() CALL, not the returned value. superForm's
    // form.update() notifies its subscribers on EVERY call — even when the
    // updater returns an unchanged object — and this effect reads $formData
    // (via $formData.name), so calling update() unconditionally re-triggers the
    // effect forever: effect_update_depth_exceeded aborts the flush and kills
    // the form's reactivity, so loc never derives and the URN preview never
    // composes as you type (#624). Only write when the loc actually changes.
    if ($formData.loc === nextLoc) return;
    formData.update((current) => ({ ...current, loc: nextLoc }), { taint: false });
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

  // #1477: ONE handler sets the flag and stores the value, in that order. With
  // `bind:value` the store write ran in bind's own listener, and a real
  // keystroke drains microtasks before the root-delegated `oninput` fires — so
  // the derive effect saw the cleared Loc with the flag still false and wrote
  // the Name slug back over the user's edit.
  function onLocInput(e: Event & { currentTarget: HTMLInputElement }) {
    locManuallyEdited = true;
    $formData.loc = e.currentTarget.value;
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

<svelte:head><title>{t('node.new.title', 'New node')} &middot; {memory.name} &middot; Hadron</title></svelte:head>

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

  <fieldset disabled={data.canWriteMemory === false}>
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
        value={$formData.loc}
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
      <label for="tags" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldTags()}
      </label>
      <input id="tags" name="tags" type="text" bind:value={$formData.tags} class={inputClass} />
    </div>

    <div>
      <label for="abstract" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {createNodeStrings.fieldAbstract()}
      </label>
      <textarea id="abstract" name="abstract" rows="3" bind:value={$formData.abstract} maxlength={ABSTRACT_MAX}
        placeholder={abstractPlaceholder()}
        aria-describedby={abstractHint ? 'abstract-search-hint' : undefined}
        class={inputClass}></textarea>
      <div class="mt-1 flex items-start justify-between gap-3">
        <!-- #936: derived from THIS memory's vector config; no claim when
             search doesn't use the abstract, or when there is no index. -->
        {#if abstractHint}
          <p id="abstract-search-hint" class="text-xs text-zinc-500 dark:text-zinc-400">{abstractHint}</p>
        {:else}
          <span></span>
        {/if}
        <p class="shrink-0 text-right text-xs {$formData.abstract.length > ABSTRACT_MAX ? 'text-red-500' : 'text-zinc-500 dark:text-zinc-400'}">{$formData.abstract.length} / {ABSTRACT_MAX}</p>
      </div>
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

    <div class="flex items-center justify-end gap-3">
      {#if submitDisabledReason && !$submitting}
        <p id="submit-disabled-reason" class="mr-auto text-xs text-zinc-500 dark:text-zinc-400" data-testid="submit-disabled-reason">
          {submitDisabledReason}
        </p>
      {/if}
      <a
        href="/app/memories/{memory.id}"
        class="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        Cancel
      </a>
      <!-- aria-disabled (not the native `disabled` attribute) keeps the button
           in the tab order so keyboard / screen-reader users can focus it and
           hear WHY it's inert — a native disabled button is skipped and its
           aria-describedby is never announced (#622 Codex review). The submit
           is still blocked: superForm's onSubmit cancels it while the form
           isn't ready, and the server re-validates regardless. -->
      <button
        type="submit"
        aria-disabled={$submitting || !!submitDisabledReason}
        aria-describedby={submitDisabledReason && !$submitting ? 'submit-disabled-reason' : undefined}
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-indigo-600"
      >
        {$submitting ? createNodeStrings.submitting() : createNodeStrings.submit()}
      </button>
    </div>
  </form>
  </fieldset>
</div>
