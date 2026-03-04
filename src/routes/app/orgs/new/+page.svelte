<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();

  let name = $state('');
  let slug = $state('');
  $effect(() => { if (form?.name) name = form.name; });
  $effect(() => { if (form?.slug) slug = form.slug; });

  // Auto-generate slug from name
  function onNameInput() {
    slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  }
</script>

<svelte:head><title>New organization · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <a href="/app/orgs" class="text-sm text-zinc-400 hover:text-white">← Organizations</a>
    <h1 class="mt-2 text-2xl font-bold text-white">New organization</h1>
  </div>

  <form method="POST" use:enhance class="space-y-5">
    {#if form?.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}

    <div>
      <label for="name" class="mb-1.5 block text-sm font-medium text-zinc-300">Organization name</label>
      <input
        id="name" name="name" type="text" required
        bind:value={name}
        oninput={onNameInput}
        placeholder="Acme Corp"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"
      />
    </div>

    <div>
      <label for="slug" class="mb-1.5 block text-sm font-medium text-zinc-300">Slug</label>
      <div class="flex items-center gap-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 focus-within:border-indigo-500">
        <span class="text-zinc-500 text-sm select-none">hadrongraph.io/</span>
        <input
          id="slug" name="slug" type="text" required
          bind:value={slug}
          pattern="[a-z0-9-]+"
          placeholder="acme-corp"
          class="flex-1 bg-transparent font-mono text-sm text-white placeholder-zinc-500 focus:outline-none"
        />
      </div>
      <p class="mt-1 text-xs text-zinc-500">Lowercase letters, numbers, and hyphens only.</p>
    </div>

    <button type="submit" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
      Create organization
    </button>
  </form>
</div>
