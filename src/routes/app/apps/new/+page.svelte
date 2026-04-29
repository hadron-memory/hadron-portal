<script lang="ts">
  import { enhance } from '$app/forms';
  import { toSlug } from '$lib/slug';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let name = $state('');
  let urn = $state('');
  let urnManuallyEdited = $state(false);
  let colonWarning = $state(false);
  let selectedOrgId = $state('');

  $effect(() => {
    if (!urnManuallyEdited) {
      urn = toSlug(name);
    }
  });

  function onUrnInput(e: Event) {
    urnManuallyEdited = true;
    colonWarning = (e.target as HTMLInputElement).value.includes(':');
  }

  const selectedOrg = $derived(data.orgs.find((o) => o.id === selectedOrgId));
</script>

<svelte:head><title>New app · Hadron</title></svelte:head>

<div class="max-w-lg">
  <div class="mb-6">
    <a href="/app/apps" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← Apps</a>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">New app</h1>
  </div>

  <form method="POST" use:enhance class="space-y-5">
    {#if form?.error}
      <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
    {/if}

    <input type="hidden" name="urn" value={urn} />
    <input type="hidden" name="displayName" value={name} />

    <div>
      <label for="displayName" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
      <input id="displayName" type="text" required placeholder="My Workstation"
        bind:value={name}
        class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
    </div>

    <div>
      <label for="urn" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">URN</label>
      <div class="flex items-stretch">
        {#if selectedOrg}
          <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">{selectedOrg.urn}:</span>
        {/if}
        <input id="urn" type="text" required placeholder="my-workstation"
          bind:value={urn}
          oninput={onUrnInput}
          class="w-full {selectedOrg ? 'rounded-r-lg' : 'rounded-lg'} border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {colonWarning ? 'border-amber-500 focus:border-amber-500' : ''}" />
      </div>
      {#if colonWarning}
        <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">Colons are used as URN delimiters and should not appear in this field.</p>
      {/if}
    </div>

    <div>
      <label for="appType" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Type</label>
      <select id="appType" name="appType" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
        <option value="WORKSTATION">💻 Workstation</option>
        <option value="CHATBOT">💬 Chatbot</option>
        <option value="AGENT">🤖 Agent</option>
        <option value="CLOUD">☁️ Cloud</option>
        <option value="IOT">📡 IoT</option>
      </select>
    </div>

    <div>
      <label for="role" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Role</label>
      <select id="role" name="role" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
        <option value="READER">Reader</option>
        <option value="CONTRIBUTOR">Contributor</option>
        <option value="ADMIN">Admin</option>
      </select>
    </div>

    <div>
      <label for="organizationId" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Organization <span class="text-zinc-500">(optional)</span></label>
      <select id="organizationId" name="organizationId" bind:value={selectedOrgId} class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
        <option value="">— none —</option>
        {#each data.orgs as org (org.id)}
          <option value={org.id}>{org.name}</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="description" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Description <span class="text-zinc-500">(optional)</span></label>
      <input id="description" name="description" type="text" placeholder="My development machine"
        class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
    </div>

    <div>
      <label for="visibility" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Visibility</label>
      <select id="visibility" name="visibility" class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
        <option value="PRIVATE" selected>Private</option>
        <option value="ORGANIZATION">Organization</option>
        <option value="PUBLIC">Public</option>
      </select>
    </div>

    <button type="submit" class="rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600">
      Create app
    </button>
  </form>
</div>
