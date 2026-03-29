<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const user = $derived(data.user);
</script>

<svelte:head><title>Account · Hadron</title></svelte:head>

<div class="max-w-lg space-y-8">
  <div>
    <Breadcrumb items={[
      { label: 'Dashboard', href: '/app/dashboard' },
      { label: 'Account' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Account</h1>
  </div>

  <!-- Profile -->
  <section>
    <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">Profile</h2>
    <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div class="flex items-center gap-4 px-5 py-4">
        {#if user.avatarUrl}
          <img src={user.avatarUrl} alt={user.name ?? ''} class="h-12 w-12 rounded-full" />
        {:else}
          <div class="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
            {(user.name ?? user.githubUsername ?? user.email ?? '?').charAt(0).toUpperCase()}
          </div>
        {/if}
        <div>
          <p class="font-medium text-zinc-900 dark:text-white">{user.name ?? 'No name set'}</p>
          {#if user.handle}
            <p class="text-sm text-zinc-500">@{user.handle}</p>
          {/if}
        </div>
      </div>

      <div class="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Handle</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{user.handle ? `@${user.handle}` : '—'}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Email</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{user.email ?? '—'}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">GitHub</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{user.githubUsername ? `@${user.githubUsername}` : '—'}</span>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">Roles</span>
          <div class="flex gap-1">
            {#each user.roles ?? [] as role}
              <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{role}</span>
            {/each}
          </div>
        </div>
      </div>
    </div>
  </section>

  <!-- Sign out -->
  <section>
    <a href="/auth/signout" data-sveltekit-reload class="inline-block rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
      Sign out
    </a>
  </section>
</div>
