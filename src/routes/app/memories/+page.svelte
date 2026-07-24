<script lang="ts">
  // "My memories" — the caller's own (org-less, user-owned) memories — plus a
  // "Memories shared with me" tab listing memories other users shared with the
  // caller via MemoryShare (#778). Shown to EVERYONE; org members have their org
  // grid separately, but their personal + shared memories live here.
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const memories = $derived(data.memories ?? []);
  const loadFailed = $derived(data.loadFailed === true);
  const sharedMemories = $derived(data.sharedMemories ?? []);
  const sharedLoadFailed = $derived(data.sharedLoadFailed === true);

  type TabId = 'mine' | 'shared';
  let activeTab = $state<TabId>('mine');

  const roleLabel = (role: string): string =>
    role === 'writer'
      ? t('my-memories.shared.role.writer', 'Can edit')
      : t('my-memories.shared.role.reader', 'Read only');

  const grantorLabel = (grantor: { handle: string | null; name: string | null }): string =>
    grantor.handle
      ? `@${grantor.handle}`
      : (grantor.name ?? t('my-memories.shared.grantor-unknown', 'someone'));
</script>

<svelte:head><title>{t('my-memories.title', 'My memories — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-4 py-6">
  <div class="flex items-center justify-between gap-3">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">{t('my-memories.heading', 'My memories')}</h1>
    <a
      href="/app/memories/new"
      class="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500"
    >{t('my-memories.new', 'New memory')}</a>
  </div>

  <!-- Tabs -->
  <div class="flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    <button
      onclick={() => (activeTab = 'mine')}
      class="border-b-2 px-4 py-2 text-sm font-medium transition
        {activeTab === 'mine'
          ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
    >
      {t('my-memories.tab.mine', 'My memories')}
    </button>
    <button
      onclick={() => (activeTab = 'shared')}
      class="border-b-2 px-4 py-2 text-sm font-medium transition
        {activeTab === 'shared'
          ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
          : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
    >
      {t('my-memories.tab.shared', 'Memories shared with me')}
      {#if sharedMemories.length > 0}
        <span class="ml-1 rounded-full bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{sharedMemories.length}</span>
      {/if}
    </button>
  </div>

  <!-- My memories tab -->
  {#if activeTab === 'mine'}
    {#if loadFailed}
      <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        {t('my-memories.load-failed', "Couldn't load your memories just now — this is a temporary error, not an empty list. Try refreshing the page.")}
      </div>
    {:else if memories.length === 0}
      <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p class="text-sm text-zinc-600 dark:text-zinc-400">
          {t('my-memories.empty', "You don't have any memories yet.")}
        </p>
        <a
          href="/app/memories/new"
          class="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
        >{t('my-memories.empty-cta', 'Create your first memory')}</a>
      </div>
    {:else}
      <ul class="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {#each memories as m (m.id)}
          <li class="flex items-center justify-between gap-3 bg-white px-4 py-3 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50">
            <div class="min-w-0">
              <a href="/app/memories/{m.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{m.name}</a>
              <div class="mt-0.5"><Urn value={m.urn} type="memory" size={10} /></div>
            </div>
            {#if m.class === 'private'}
              <span class="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{t('my-memories.badge.private', 'Private')}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}

  <!-- Memories shared with me tab -->
  {#if activeTab === 'shared'}
    {#if sharedLoadFailed}
      <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        {t('my-memories.shared.load-failed', "Couldn't load memories shared with you just now — this is a temporary error, not an empty list. Try refreshing the page.")}
      </div>
    {:else if sharedMemories.length === 0}
      <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-10 text-center dark:border-zinc-700 dark:bg-zinc-900">
        <p class="text-sm text-zinc-600 dark:text-zinc-400">
          {t('my-memories.shared.empty', 'No one has shared a memory with you yet.')}
        </p>
      </div>
    {:else}
      <ul class="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {#each sharedMemories as m (m.id)}
          <li class="flex items-center justify-between gap-3 bg-white px-4 py-3 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/50">
            <div class="min-w-0">
              <a href="/app/memories/{m.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{m.name}</a>
              <div class="mt-0.5"><Urn value={m.urn} type="memory" size={10} /></div>
              {#if m.myShare}
                <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {t('my-memories.shared.by', 'Shared by {who}').replace('{who}', grantorLabel(m.myShare.grantor))}
                </p>
              {/if}
            </div>
            {#if m.myShare}
              <span class="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{roleLabel(m.myShare.role)}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
