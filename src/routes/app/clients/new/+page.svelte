<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>New client · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <a href="/app/clients" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Clients</a>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">New client</h1>
  </div>

  <form method="POST" use:enhance class="space-y-5">
    {#if form?.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}

    <div>
      <label for="label" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Label <span class="text-zinc-500">(unique identifier)</span></label>
      <input id="label" name="label" type="text" required placeholder="my-workstation"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
    </div>

    <div>
      <label for="clientType" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
      <select id="clientType" name="clientType" class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
        <option value="WORKSTATION">💻 Workstation</option>
        <option value="AGENT">🤖 Agent</option>
        <option value="CLOUD">☁️ Cloud</option>
        <option value="IOT">📡 IoT</option>
      </select>
    </div>

    <div>
      <label for="role" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Role</label>
      <select id="role" name="role" class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
        <option value="READER">Reader</option>
        <option value="CONTRIBUTOR">Contributor</option>
        <option value="ADMIN">Admin</option>
      </select>
    </div>

    <div>
      <label for="organizationId" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Organization <span class="text-zinc-500">(optional)</span></label>
      <select id="organizationId" name="organizationId" class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
        <option value="">— none —</option>
        {#each data.orgs as org (org.id)}
          <option value={org.id}>{org.name}</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="description" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description <span class="text-zinc-500">(optional)</span></label>
      <input id="description" name="description" type="text" placeholder="My development machine"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
    </div>

    <div>
      <label for="namespace" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Namespace restriction <span class="text-zinc-500">(optional, for CONTRIBUTORs)</span></label>
      <input id="namespace" name="namespace" type="text" placeholder="my-org.my-repo"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
    </div>

    <div>
      <label for="expiresAt" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Expires <span class="text-zinc-500">(optional)</span></label>
      <input id="expiresAt" name="expiresAt" type="date"
        class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none" />
    </div>

    <button type="submit" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
      Create client
    </button>
  </form>
</div>
