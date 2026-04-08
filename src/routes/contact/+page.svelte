<script lang="ts">
  import { enhance } from '$app/forms';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
  const f = $derived(form as Record<string, unknown> | null);
</script>

<svelte:head><title>Contact · Hadron</title></svelte:head>

<div class="mx-auto max-w-lg px-4 py-16">
  <h1 class="mb-6 text-center text-3xl font-bold text-zinc-900 dark:text-white">Get in touch</h1>

  {#if f?.success}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300 text-center">
      Message sent! We'll get back to you soon.
    </div>
  {:else}
    {#if f?.error}
      <div class="mb-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{f.error}</div>
    {/if}
    <form method="POST" use:enhance class="space-y-4 rounded-2xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <label for="contactName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
        <input id="contactName" type="text" name="name" required placeholder="Your name"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500" />
      </div>
      <div>
        <label for="contactEmail" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
        <input id="contactEmail" type="email" name="email" required placeholder="you@example.com"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500" />
      </div>
      <div>
        <label for="contactMessage" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Message</label>
        <textarea id="contactMessage" name="message" required rows="4" placeholder="How can we help?"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-white dark:placeholder-zinc-500"></textarea>
      </div>
      <button type="submit" class="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600">
        Send message
      </button>
    </form>
  {/if}
</div>
