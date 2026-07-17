<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { toSlug } from '$lib/slug';
  import type { ActionData, PageData } from './$types';
  import { createOrganizationSchema } from './schema';

  let { form, data }: { form: ActionData; data: PageData } = $props();

  const initialForm = untrack(() => form?.form ?? data.form);
  const {
    form: formData,
    errors,
    constraints,
    message,
    allErrors,
    submitting,
    enhance,
  } = superForm(initialForm, {
    validators: zod4Client(createOrganizationSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // #320: seed the URN slug once when the command bar deep-links here. untrack
  // makes the one-time snapshot explicit (data won't change without a reload).
  // #320: a prefilled (or manually-edited) URN must not be clobbered by
  // name-driven auto-generation.
  let urnEdited = $state(untrack(() => !!data.prefillUrn || !!form?.form?.data.urn));
  let submitAttempted = $state(untrack(() => !!form?.form));
  const nameError = $derived($errors.name?.[0] ?? null);
  const urnError = $derived($errors.urn?.[0] ?? null);
  const showUrnError = $derived(!!$formData.urn && !!urnError);
  const actionError = $derived($message ?? (submitAttempted ? ($allErrors[0]?.messages[0] ?? null) : null));

  // Auto-generate URN from name until the user (or a prefill) owns the field.
  function onNameInput() {
    if (urnEdited) return;
    const nextUrn = toSlug($formData.name);
    if ($formData.urn !== nextUrn) formData.update((current) => ({ ...current, urn: nextUrn }), { taint: false });
  }
</script>

<svelte:head><title>New organization · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <a href="/app/orgs" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Organizations</a>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">New organization</h1>
  </div>

  <form method="POST" onsubmit={() => { submitAttempted = true; }} use:enhance class="space-y-5" novalidate>
    {#if actionError}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
    {/if}

    <div>
      <label for="name" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Organization name</label>
      <input
        id="name" name="name" type="text" required
        bind:value={$formData.name}
        oninput={onNameInput}
        aria-invalid={!!nameError}
        aria-describedby={nameError ? 'nameError' : undefined}
        {...$constraints.name}
        placeholder="Acme Corp"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none {nameError ? 'border-red-500 focus:border-red-500' : ''}"
      />
      {#if nameError}
        <p id="nameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{nameError}</p>
      {/if}
    </div>

    <div>
      <label for="urn" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
      <div class="flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 focus-within:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900">
        <span class="select-none font-mono text-sm text-zinc-500">hrn:org:</span>
        <input
          id="urn" name="urn" type="text" required
          bind:value={$formData.urn}
          oninput={() => (urnEdited = true)}
          aria-invalid={showUrnError}
          aria-describedby={showUrnError ? 'urnError' : 'urnHelp'}
          {...$constraints.urn}
          placeholder="acme-corp"
          class="flex-1 bg-transparent font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-white dark:placeholder-zinc-500"
        />
      </div>
      {#if showUrnError}
        <p id="urnError" class="mt-1 text-xs text-red-600 dark:text-red-400">{urnError}</p>
      {:else}
        <p id="urnHelp" class="mt-1 text-xs text-zinc-500">Lowercase letters, numbers, dots, underscores, and hyphens. Must start and end with a letter or number.</p>
      {/if}
    </div>

    <button type="submit" disabled={showUrnError || $submitting} class="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">
      {$submitting ? 'Creating...' : 'Create organization'}
    </button>
  </form>
</div>
