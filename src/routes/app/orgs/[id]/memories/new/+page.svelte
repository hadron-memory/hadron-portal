<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';
  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>Add memory · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <a href="/app/orgs/{data.orgId}/memories" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Memories</a>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Add memory</h1>
  </div>

  <form method="POST" use:enhance class="space-y-5">
    {#if form?.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}

    <div>
      <label for="name" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Memory name <span class="text-zinc-500">(e.g. owner/repo)</span></label>
      <input id="name" name="name" type="text" required placeholder="my-org/my-repo"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
    </div>

    <div>
      <label for="shortDescription" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Short description</label>
      <input id="shortDescription" name="shortDescription" type="text" placeholder="One-line summary"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
    </div>

    <div>
      <label for="description" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description</label>
      <textarea id="description" name="description" rows="3" placeholder="Full description (supports markdown)"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none"></textarea>
    </div>

    <div>
      <label for="tags" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Tags <span class="text-zinc-500">(comma-separated)</span></label>
      <input id="tags" name="tags" type="text" placeholder="meal-planning, nutrition, family"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
    </div>

    <div class="grid grid-cols-3 gap-4">
      <div>
        <label for="category0" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Category</label>
        <input id="category0" name="category0" type="text" placeholder="Primary"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div>
        <label for="category1" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Subcategory</label>
        <input id="category1" name="category1" type="text" placeholder="Secondary"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div>
        <label for="category2" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Sub-subcategory</label>
        <input id="category2" name="category2" type="text" placeholder="Tertiary"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="license" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">License</label>
        <input id="license" name="license" type="text" placeholder="MIT, CC-BY-4.0, proprietary"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div>
        <label for="homeUrl" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Home URL</label>
        <input id="homeUrl" name="homeUrl" type="url" placeholder="https://example.com"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="iconUrl" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Icon URL</label>
        <input id="iconUrl" name="iconUrl" type="url" placeholder="https://example.com/icon.png"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div>
        <label for="heroUrl" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Hero image URL</label>
        <input id="heroUrl" name="heroUrl" type="url" placeholder="https://example.com/hero.jpg"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
    </div>

    <div>
      <label for="source" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Git source URL <span class="text-zinc-500">(optional — leave blank for DB-only)</span></label>
      <input id="source" name="source" type="url" placeholder="https://github.com/owner/repo.git"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <div>
        <label for="readBranch" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Read branch</label>
        <input id="readBranch" name="readBranch" type="text" placeholder="main"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
      <div>
        <label for="writeBranch" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Write branch</label>
        <input id="writeBranch" name="writeBranch" type="text" placeholder="hadron-updates"
          class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
      </div>
    </div>

    <div>
      <label for="visibility" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
      <select id="visibility" name="visibility" class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
        <option value="PRIVATE">Private</option>
        <option value="ORGANIZATION">Organization</option>
        <option value="PUBLIC">Public</option>
      </select>
    </div>

    <button type="submit" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
      Add memory
    </button>
  </form>
</div>
