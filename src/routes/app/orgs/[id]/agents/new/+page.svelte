<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { toSlug } from '$lib/slug';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';
  import { createAgentSchema } from './schema';
  let { data, form }: { data: PageData; form: ActionData } = $props();

  const initialForm = untrack(() => form?.form ?? data.form);

  const {
    form: formData,
    errors,
    constraints,
    message,
    allErrors,
    enhance,
  } = superForm(initialForm, {
    validators: zod4Client(createAgentSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  // #320: a prefilled slug counts as "edited" so name-derivation won't clobber it.
  let slugEdited = $state(untrack(() => !!data.prefillSlug));
  let submitAttempted = $state(untrack(() => !!form?.form));
  const displayNameError = $derived($errors.displayName?.[0] ?? null);
  const slugError = $derived($errors.slug?.[0] ?? null);
  const actionError = $derived($message ?? (submitAttempted ? ($allErrors[0]?.messages[0] ?? null) : null));
  const colonWarning = $derived($formData.slug.includes(':'));

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function onDisplayNameInput(event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const nextSlug = toSlug(target.value);
    if (!slugEdited && $formData.slug !== nextSlug) {
      formData.update((current) => ({ ...current, slug: nextSlug }), { taint: false });
    }
  }

  function onSlugInput() {
    slugEdited = true;
  }

  function markSubmitAttempted() {
    submitAttempted = true;
  }
</script>

<svelte:head><title>New Agent · {data.org.name} · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <Breadcrumb items={[
      { label: 'Agents', href: `/app/orgs/${data.org.id}/agents` },
      { label: 'New' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">New Agent</h1>
  </div>

  <form method="POST" onsubmit={markSubmitAttempted} use:enhance class="space-y-5" novalidate>
    {#if actionError}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
    {/if}

    <div>
      <label for="displayName" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
      <input id="displayName" name="displayName" type="text" required placeholder="Engineering"
        bind:value={$formData.displayName}
        oninput={onDisplayNameInput}
        aria-invalid={!!displayNameError}
        aria-describedby={displayNameError ? 'displayNameError' : undefined}
        {...$constraints.displayName}
        class="{inputClass} {displayNameError ? 'border-red-500 focus:border-red-500' : ''}" />
      {#if displayNameError}
        <p id="displayNameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{displayNameError}</p>
      {/if}
    </div>

    <div>
      <label for="slug" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
      <div class="flex items-stretch">
        <span class="inline-flex shrink-0 items-center whitespace-nowrap rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{data.org.urn}:</span>
        <input id="slug" name="slug" type="text" required placeholder="engineering"
          bind:value={$formData.slug}
          oninput={onSlugInput}
          aria-invalid={!!slugError}
          aria-describedby={slugError ? 'slugError' : colonWarning ? 'slugWarning' : undefined}
          {...$constraints.slug}
          class="min-w-0 w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {slugError ? 'border-red-500 focus:border-red-500' : colonWarning ? 'border-amber-500 focus:border-amber-500' : ''}" />
      </div>
      {#if slugError}
        <p id="slugError" class="mt-1 text-xs text-red-600 dark:text-red-400">{slugError}</p>
      {/if}
      {#if colonWarning}
        <p id="slugWarning" class="mt-1 text-xs text-amber-600 dark:text-amber-400">Colons are used as URN delimiters and should not appear in the slug.</p>
      {/if}
    </div>

    <div>
      <label for="description" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description <span class="text-zinc-500">(optional)</span></label>
      <textarea id="description" name="description" rows="3" placeholder="What this agent is for"
        bind:value={$formData.description}
        class={inputClass}></textarea>
    </div>

    <div>
      <label for="systemPrompt" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">System Prompt <span class="text-zinc-500">(optional)</span></label>
      <textarea id="systemPrompt" name="systemPrompt" rows="4" placeholder="Instructions for the LLM when using this agent"
        bind:value={$formData.systemPrompt}
        class={inputClass}></textarea>
      <p class="mt-1 text-xs text-zinc-400">Sent to the LLM at the start of each session. Used to define the agent's behavior and personality.</p>
    </div>

    <div>
      <label for="visibility" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
      <select id="visibility" name="visibility" bind:value={$formData.visibility} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
        <option value="PERSONAL">Personal</option>
        <option value="ORGANIZATION">Organization</option>
        <option value="PUBLIC">Public</option>
      </select>
    </div>

    <div class="flex gap-3">
      <button type="submit" class="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600">Create Agent</button>
      <a href="/app/orgs/{data.org.id}/agents" class="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</a>
    </div>
  </form>
</div>
