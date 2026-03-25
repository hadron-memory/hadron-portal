<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head><title>New station · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <a href="/app/stations" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Stations</a>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">New station</h1>
  </div>

  <form method="POST" use:enhance class="space-y-5">
    {#if form?.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}

    <div>
      <label for="name" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name <span class="text-zinc-500">(unique identifier)</span></label>
      <input id="name" name="name" type="text" required placeholder="my-workstation"
        class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
    </div>

    <div>
      <label for="stationType" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
      <select id="stationType" name="stationType" class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
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

<fieldset>
      <legend class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">AI agent tools <span class="text-zinc-500">(select the tools this station will use)</span></legend>
      <div class="space-y-2">
        {#each [
          { value: 'CLAUDE_CODE', label: 'Claude Code' },
          { value: 'CURSOR', label: 'Cursor' },
          { value: 'WINDSURF', label: 'Windsurf' },
          { value: 'CLAUDE_DESKTOP', label: 'Claude Desktop' },
          { value: 'CODEX', label: 'Codex CLI' },
          { value: 'CLINE', label: 'Cline' },
        ] as tool (tool.value)}
          <label class="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
            <input type="checkbox" name="agentTools" value={tool.value}
              class="rounded border-zinc-300 bg-white text-indigo-500 focus:ring-indigo-500 dark:border-zinc-600 dark:bg-zinc-800" />
            {tool.label}
          </label>
        {/each}
      </div>
    </fieldset>

    <div>
      <label for="expiresAt" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Expires <span class="text-zinc-500">(optional)</span></label>
      <input id="expiresAt" name="expiresAt" type="date"
        class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white focus:border-indigo-500 focus:outline-none" />
    </div>

    <button type="submit" class="rounded-lg bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
      Create station
    </button>
  </form>
</div>
