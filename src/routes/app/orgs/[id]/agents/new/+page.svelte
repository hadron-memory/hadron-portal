<script lang="ts">
  import { enhance } from '$app/forms';
  import { toSlug } from '$lib/slug';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();

  let name = $state('');
  let slug = $state('');
  let slugEdited = $state(false);
  let colonWarning = $state(false);

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  $effect(() => {
    if (!slugEdited) {
      slug = toSlug(name);
    }
  });

  function onSlugInput(e: Event) {
    slugEdited = true;
    const value = (e.target as HTMLInputElement).value;
    colonWarning = value.includes(':');
  }
</script>

<svelte:head><title>New Agent · {data.org.name} · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <Breadcrumb items={[
      { label: 'Organizations', href: '/app/orgs' },
      { label: data.org.name, href: `/app/orgs/${data.org.id}` },
      { label: 'Agents', href: `/app/orgs/${data.org.id}/agents` },
      { label: 'New' },
    ]} />
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
          oninput={onSlugInput}
          class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {colonWarning ? 'border-amber-500 focus:border-amber-500' : ''}" />
      </div>
      {#if colonWarning}
        <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">Colons are used as URN delimiters and should not appear in the slug.</p>
      {/if}
    </div>

    <div>
      <label for="description" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description <span class="text-zinc-500">(optional)</span></label>
      <textarea id="description" name="description" rows="3" placeholder="What this agent is for"
        class={inputClass}></textarea>
    </div>

    <div class="flex gap-3">
      <button type="submit" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">Create Agent</button>
      <a href="/app/orgs/{data.org.id}/agents" class="rounded-lg border border-zinc-300 px-5 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">Cancel</a>
    </div>
  </form>
</div>
