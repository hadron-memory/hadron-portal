<script lang="ts">
  // #636: org-less "create an agent" form for individual users. Mirrors the
  // personal-memory create form's slug-from-name derivation (via oninput, NOT an
  // effect, to avoid the superForm self-loop from #624).
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { toSlug } from '$lib/slug';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';
  import type { ActionData, PageData } from './$types';
  import { createPersonalAgentSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const initialForm = untrack(() => form?.form ?? data.form);
  const {
    form: formData,
    errors,
    constraints,
    message,
    submitting,
    enhance,
  } = superForm(initialForm, {
    validators: zod4Client(createPersonalAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  let slugManuallyEdited = $state(untrack(() => !!data.prefillSlug));
  const displayNameError = $derived($errors.displayName?.[0] ?? null);
  const slugError = $derived($errors.slug?.[0] ?? null);
  const actionError = $derived($message?.type === 'error' ? $message.text : null);

  function onDisplayNameInput(event: Event) {
    const nextSlug = toSlug((event.currentTarget as HTMLInputElement).value);
    if (!slugManuallyEdited && $formData.slug !== nextSlug) {
      formData.update((current) => ({ ...current, slug: nextSlug }), { taint: false });
    }
  }

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

<svelte:head><title>{t('personal-agent.new.title', 'New agent — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-4 p-4">
  <Breadcrumb items={[
    { href: '/app/dashboard', label: t('personal-agent.breadcrumb', 'Dashboard') },
    { label: t('personal-agent.new.crumb', 'New agent') },
  ]} />

  <div>
    <h1 class="text-xl font-semibold text-zinc-900 dark:text-white">
      {t('personal-agent.new.heading', 'Create an agent')}
    </h1>
    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
      {t('personal-agent.new.subtitle', 'This agent is yours — owned by your account, not an organization.')}
    </p>
  </div>

  {#if actionError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
      {actionError}
    </div>
  {/if}

  <form method="POST" use:enhance class="space-y-4" novalidate>
    <div>
      <label for="displayName" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {t('personal-agent.field.name', 'Name')}
      </label>
      <input
        id="displayName" name="displayName" type="text" required
        bind:value={$formData.displayName} oninput={onDisplayNameInput}
        aria-invalid={!!displayNameError}
        aria-describedby={displayNameError ? 'displayNameError' : undefined}
        {...$constraints.displayName}
        class="{inputClass} {displayNameError ? 'border-red-500 focus:border-red-500' : ''}"
        placeholder="e.g. My research assistant"
      />
      {#if displayNameError}
        <p id="displayNameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{displayNameError}</p>
      {/if}
    </div>

    <div>
      <label for="slug" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {t('personal-agent.field.slug', 'Address (slug)')}
      </label>
      <input
        id="slug" name="slug" type="text" required
        bind:value={$formData.slug} oninput={() => (slugManuallyEdited = true)}
        aria-invalid={!!slugError}
        aria-describedby={slugError ? 'slugError slugHint' : 'slugHint'}
        {...$constraints.slug}
        class="{inputClass} {slugError ? 'border-red-500 focus:border-red-500' : ''}"
        placeholder="e.g. research-assistant"
      />
      <p id="slugHint" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t('personal-agent.hint.slug', 'Letters, digits, hyphens, and underscores. Used to address the agent.')}
      </p>
      {#if slugError}
        <p id="slugError" class="mt-1 text-xs text-red-600 dark:text-red-400">{slugError}</p>
      {/if}
    </div>

    <div>
      <label for="description" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
        {t('personal-agent.field.description', 'Description')}
      </label>
      <input id="description" name="description" type="text" bind:value={$formData.description} class={inputClass} />
    </div>

    <div class="flex items-center justify-end gap-3">
      <a href="/app/dashboard" class="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
        {t('personal-agent.new.cancel', 'Cancel')}
      </a>
      <button
        type="submit"
        disabled={$submitting || !$formData.displayName.trim() || !$formData.slug.trim()}
        class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      >
        {$submitting ? t('personal-agent.new.creating', 'Creating…') : t('personal-agent.new.submit', 'Create agent')}
      </button>
    </div>
  </form>
</div>
