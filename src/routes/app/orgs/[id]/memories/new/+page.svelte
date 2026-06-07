<script lang="ts">
  import { enhance } from '$app/forms';
  import { toSlug } from '$lib/slug';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();

  let name = $state('');
  let slug = $state('');
  let slugManuallyEdited = $state(false);
  let githubOpen = $state(false);
  let colonWarning = $state(false);
  // Spec 034: knowledge = org-shared (visibility-governed); personal/private =
  // owner-only (visibility is auto-derived server-side, so we hide that knob).
  let memoryClass = $state<'knowledge' | 'personal' | 'private'>('knowledge');
  const isOwnerOnly = $derived(memoryClass === 'personal' || memoryClass === 'private');

  $effect(() => {
    if (!slugManuallyEdited) {
      slug = toSlug(name);
    }
  });

  function onSlugInput(e: Event) {
    slugManuallyEdited = true;
    colonWarning = (e.target as HTMLInputElement).value.includes(':');
  }
</script>

<svelte:head><title>Add memory · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <Breadcrumb items={[
      { label: 'Memories', href: `/app/orgs/${data.org.id}/memories` },
      { label: 'New' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Add memory</h1>
  </div>

  <form method="POST" use:enhance class="space-y-5">
    {#if form?.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}

    <!-- slug is used for URN; displayName is the human-friendly name -->
    <input type="hidden" name="slug" value={slug} />
    <input type="hidden" name="displayName" value={name} />

    <div>
      <label for="displayName" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
      <input id="displayName" type="text" required placeholder="My Knowledge Base"
        bind:value={name}
        class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
    </div>

    <div>
      <label for="slug" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
      <div class="flex items-stretch">
        <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{data.org.urn}:</span>
        <input id="slug" type="text" required placeholder="my-knowledge-base"
          bind:value={slug}
          oninput={onSlugInput}
          class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {colonWarning ? 'border-amber-500 focus:border-amber-500' : ''}" />
      </div>
      {#if colonWarning}
        <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">Colons are used as URN delimiters and should not appear in the slug.</p>
      {/if}
    </div>

    <div>
      <label for="shortDescription" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Short description</label>
      <input id="shortDescription" name="shortDescription" type="text" placeholder="One-line summary"
        class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
    </div>

    <div>
      <label for="description" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
      <textarea id="description" name="description" rows="3" placeholder="Full description (supports markdown)"
        class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"></textarea>
    </div>

    <div>
      <label for="tags" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
      <input id="tags" name="tags" type="text" placeholder="meal-planning, nutrition, family"
        class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
    </div>

    <div class="grid grid-cols-3 gap-4">
      <div>
        <label for="category0" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Category</label>
        <input id="category0" name="category0" type="text" placeholder="Primary"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      </div>
      <div>
        <label for="category1" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Subcategory</label>
        <input id="category1" name="category1" type="text" placeholder="Secondary"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      </div>
      <div>
        <label for="category2" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-subcategory</label>
        <input id="category2" name="category2" type="text" placeholder="Tertiary"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="license" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">License</label>
        <input id="license" name="license" type="text" placeholder="MIT, CC-BY-4.0, proprietary"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      </div>
      <div>
        <label for="homeUrl" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Home URL</label>
        <input id="homeUrl" name="homeUrl" type="url" placeholder="https://example.com"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="iconUrl" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Icon URL</label>
        <input id="iconUrl" name="iconUrl" type="url" placeholder="https://example.com/icon.png"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      </div>
      <div>
        <label for="heroUrl" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Hero image URL</label>
        <input id="heroUrl" name="heroUrl" type="url" placeholder="https://example.com/hero.jpg"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
      </div>
    </div>

    <div>
      <label for="memoryClass" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Memory kind</label>
      <select id="memoryClass" name="memoryClass" bind:value={memoryClass} class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
        <option value="knowledge">Organization knowledge</option>
        <option value="personal">Personal — only you (shareable later)</option>
        <option value="private">Private — only you</option>
      </select>
      {#if isOwnerOnly}
        <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Only you can read or write this memory. The organization is just a container and is granted no access.</p>
      {/if}
    </div>

    {#if memoryClass === 'knowledge'}
      <div>
        <label for="visibility" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
        <select id="visibility" name="visibility" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          <option value="PRIVATE">Private</option>
          <option value="ORGANIZATION">Organization</option>
          <option value="PUBLIC">Public</option>
        </select>
      </div>
    {/if}

    <!-- GitHub integration (collapsed by default) -->
    <div class="rounded-lg border border-zinc-200 dark:border-zinc-800">
      <button
        type="button"
        onclick={() => githubOpen = !githubOpen}
        class="flex w-full items-center justify-between px-4 py-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:text-zinc-300 dark:hover:bg-zinc-800/50 rounded-lg"
      >
        <span>GitHub integration <span class="font-normal text-zinc-500">(optional)</span></span>
        <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {githubOpen ? 'rotate-90' : ''}">
          <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
        </svg>
      </button>

      {#if githubOpen}
        <div class="space-y-4 border-t border-zinc-200 px-4 py-4 dark:border-zinc-800">
          <div>
            <label for="source" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Git source URL</label>
            <input id="source" name="source" type="url" placeholder="https://github.com/owner/repo.git"
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <label for="readBranch" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Read branch</label>
              <input id="readBranch" name="readBranch" type="text" placeholder="main"
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
            </div>
            <div>
              <label for="writeBranch" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Write branch</label>
              <input id="writeBranch" name="writeBranch" type="text" placeholder="hadron-updates"
                class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
            </div>
          </div>
        </div>
      {/if}
    </div>

    <button type="submit" class="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600">
      Add memory
    </button>
  </form>
</div>
