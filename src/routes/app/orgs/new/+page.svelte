<script lang="ts">
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import type { ActionData, PageData } from './$types';

  let { form, data }: { form: ActionData; data: PageData } = $props();

  let name = $state('');
  // #320: seed the URN slug once when the command bar deep-links here. untrack
  // makes the one-time snapshot explicit (data won't change without a reload).
  let urn = $state(untrack(() => data.prefillUrn ?? ''));
  $effect(() => { if (form?.name) name = form.name; });
  $effect(() => { if (form?.urn) urn = form.urn; });

  // Auto-generate URN from name
  function onNameInput() {
    urn = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
</script>

<svelte:head><title>New organization · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <a href="/app/orgs" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Organizations</a>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">New organization</h1>
  </div>

  <form method="POST" use:enhance class="space-y-5">
    {#if form?.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}

    <div>
      <label for="name" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Organization name</label>
      <input
        id="name" name="name" type="text" required
        bind:value={name}
        oninput={onNameInput}
        placeholder="Acme Corp"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
      />
    </div>

    <div>
      <label for="urn" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
      <div class="flex items-center gap-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 focus-within:border-indigo-500 dark:border-zinc-700 dark:bg-zinc-900">
        <span class="text-zinc-500 text-sm select-none">hadrongraph.io/</span>
        <input
          id="urn" name="urn" type="text" required
          bind:value={urn}
          pattern="[a-z0-9-]+"
          placeholder="acme-corp"
          class="flex-1 bg-transparent font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:outline-none dark:text-white dark:placeholder-zinc-500"
        />
      </div>
      <p class="mt-1 text-xs text-zinc-500">Lowercase letters, numbers, and hyphens only.</p>
    </div>

    <button type="submit" class="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600">
      Create organization
    </button>
  </form>
</div>
