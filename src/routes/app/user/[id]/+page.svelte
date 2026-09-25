<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import HeldWorkersTable from '$lib/components/HeldWorkersTable.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const user = $derived(data.user);
  const held = $derived(data.heldWorkers);

  // Best public identifier we're allowed to show: handle, then @github.
  // Never a name or email (the profile selects only public fields).
  const label = $derived(user.handle ? `@${user.handle}` : user.githubUsername ? `@${user.githubUsername}` : null);

  // Avatar fallback: first character of the best identifier, uppercased.
  const initial = $derived((user.handle ?? user.githubUsername ?? '?').charAt(0).toUpperCase());
</script>

<svelte:head><title>{label ?? t('user.profile.title', 'Profile')} · Hadron</title></svelte:head>

<div class="space-y-6">
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

<!-- #919 — the profile's tabs. Workers is the first and, for now, only one
     (Holger), built as a real tab strip so later tabs slot in beside it. -->
<div>
  <div role="tablist" aria-label={t('user.profile.tabs', 'Profile sections')} class="flex gap-1 overflow-x-auto border-b border-zinc-200 dark:border-zinc-800">
    <button
      type="button"
      role="tab"
      id="user-tab-workers"
      aria-selected="true"
      aria-controls="user-panel-workers"
      class="-mb-px shrink-0 whitespace-nowrap border-b-2 border-indigo-500 px-3 py-2 text-sm font-medium text-zinc-900 dark:text-white"
    >
      {t('user.profile.tab.workers', 'Workers')}
    </button>
  </div>
  <div role="tabpanel" id="user-panel-workers" aria-labelledby="user-tab-workers" class="pt-4">
    <p class="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
      {t('user.workers.intro', 'Workers this user holds, in Apps you can see. A worker with a live session is marked “Active now”.')}
    </p>
    {#if !held.ok}
      <p role="alert" data-testid="held-workers-failed" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
        {t('user.workers.failed', 'The workers could not be loaded: {detail}', { detail: held.detail })}
      </p>
    {:else if held.items.length === 0}
      <!-- Not "holds no workers": holds in Apps this viewer cannot read are
           invisible here by design, so the honest claim is about visibility. -->
      <p data-testid="held-workers-empty" class="text-sm text-zinc-500 dark:text-zinc-400">
        {t('user.workers.empty', 'No workers you can see are held by this user.')}
      </p>
    {:else}
      <!-- Every visible held worker: the loader pages to completion, so the
           grid never holds a partial roster it would have to caveat. -->
      <!-- Keyed by the profile: SvelteKit reuses this page across /app/user
           URLs, and a reused grid would carry the last profile's search into
           this one, where it can hide every row (@codex on #930). -->
      {#key user.id}
        <HeldWorkersTable workers={held.items} />
      {/key}
    {/if}
  </div>
</div>
</div>
