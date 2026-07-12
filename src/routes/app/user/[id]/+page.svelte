<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const user = $derived(data.user);

  // Best public identifier we're allowed to show: handle, then @github.
  // Never a name or email (the profile selects only public fields).
  const label = $derived(user.handle ? `@${user.handle}` : user.githubUsername ? `@${user.githubUsername}` : null);

  // Avatar fallback: first character of the best identifier, uppercased.
  const initial = $derived((user.handle ?? user.githubUsername ?? '?').charAt(0).toUpperCase());
</script>

<svelte:head><title>{label ?? t('user.profile.title', 'Profile')} · Hadron</title></svelte:head>

<div class="max-w-lg">
  <section class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
    <div class="flex items-center gap-4 px-5 py-5">
      {#if user.avatarUrl}
        <img src={user.avatarUrl} alt="" class="h-16 w-16 shrink-0 rounded-full" />
      {:else}
        <span
          class="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-zinc-200 text-xl font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
        >{initial}</span>
      {/if}

      <div class="min-w-0 flex-1">
        {#if user.urn}
          <Urn value={user.urn} type="user" />
        {:else if label}
          <span class="truncate font-mono text-lg font-medium text-zinc-900 dark:text-white">{label}</span>
        {:else}
          <span class="text-sm text-zinc-500 dark:text-zinc-400"
            >{t('user.profile.no-handle', 'This user has not set a handle.')}</span
          >
        {/if}
      </div>
    </div>
  </section>
</div>
