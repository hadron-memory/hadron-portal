<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();

  let name = $state('');
  let slug = $state('');
  let slugEdited = $state(false);

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  $effect(() => {
    if (!slugEdited) {
      slug = name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    }
  });
</script>

<svelte:head><title>New Agent · {data.org.name} · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <nav class="flex items-center gap-1 text-sm">
      <a href="/app/orgs" class="text-indigo-500 hover:underline dark:text-indigo-400">Organizations</a>
      <span class="text-zinc-400">/</span>
      <a href="/app/orgs/{data.org.id}" class="text-indigo-500 hover:underline dark:text-indigo-400">{data.org.name}</a>
      <span class="text-zinc-400">/</span>
      <a href="/app/orgs/{data.org.id}/bundles" class="text-indigo-500 hover:underline dark:text-indigo-400">Agents</a>
      <span class="text-zinc-400">/</span>
      <span class="text-zinc-700 dark:text-zinc-300">New</span>
    </nav>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">New Agent</h1>
  </div>

  <form method="POST" use:enhance class="space-y-5">
    {#if form?.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}

    <input type="hidden" name="name" value={slug} />

    <div>
      <label for="displayName" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
      <input id="displayName" type="text" required placeholder="Engineering"
        bind:value={name}
        class={inputClass} />
    </div>

    <div>
      <label for="slug" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
      <div class="flex items-stretch">
        <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{data.org.urn}:</span>
        <input id="slug" type="text" required placeholder="engineering"
          bind:value={slug}
          oninput={() => slugEdited = true}
          class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      </div>
    </div>

    <div>
      <label for="description" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description <span class="text-zinc-500">(optional)</span></label>
      <input id="description" name="description" type="text" placeholder="What this agent is for"
        class={inputClass} />
    </div>

    <div class="flex gap-3">
      <button type="submit" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Create Agent</button>
      <a href="/app/orgs/{data.org.id}/bundles" class="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</a>
    </div>
  </form>
</div>
