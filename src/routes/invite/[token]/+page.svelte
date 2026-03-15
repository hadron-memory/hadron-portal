<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Invite · Hadron</title></svelte:head>

<div class="mx-auto max-w-lg px-4 py-16">
  <div class="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invites unavailable</h1>
    <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">The invite system is currently not available. Please contact your organization admin to be added directly.</p>
    <a href="/" class="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go home</a>
  </div>
</div>
