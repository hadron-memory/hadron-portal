<script lang="ts">
  // #266: Integrations tab — GitHub source + branches and the sync/push actions,
  // split out of the Settings page.
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);

  let saving = $state(false);
  let syncing = $state(false);
  let pushing = $state(false);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

  function savingEnhance(el: HTMLFormElement) {
    return enhance(el, () => { saving = true; return async ({ update }) => { saving = false; await update(); }; });
  }
  function syncingEnhance(el: HTMLFormElement) {
    return enhance(el, () => { syncing = true; return async ({ update }) => { syncing = false; await update(); }; });
  }
  function pushingEnhance(el: HTMLFormElement) {
    return enhance(el, () => { pushing = true; return async ({ update }) => { pushing = false; await update(); }; });
  }

  function fmtDate(s: string | null | undefined): string {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

<svelte:head><title>{g.name} &middot; Integrations &middot; Hadron</title></svelte:head>

<div class="max-w-lg space-y-8">
  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.success || form?.synced || (form as any)?.pushed}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {form?.synced ? t('integrations.synced', 'Memory synced.') : (form as any)?.pushed ? t('integrations.pushed', 'Pushed to Git.') : t('integrations.saved', 'Changes saved.')}
    </div>
  {/if}

  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">{t('integrations.github', 'GitHub')}</h2>
    <form method="POST" action="?/update" use:savingEnhance class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div>
        <label for="source" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">{t('integrations.source-url', 'Git source URL')}</label>
        <input id="source" name="source" type="text" value={g.source ?? ''} placeholder="https://github.com/owner/repo.git" class={inputClass} />
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="readBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">{t('integrations.read-branch', 'Read branch')}</label>
          <input id="readBranch" name="readBranch" type="text" value={g.readBranch ?? ''} placeholder="main" class={inputClass} />
        </div>
        <div>
          <label for="writeBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">{t('integrations.write-branch', 'Write branch')}</label>
          <input id="writeBranch" name="writeBranch" type="text" value={g.writeBranch ?? ''} placeholder="hadron-updates" class={inputClass} />
        </div>
      </div>
      <button type="submit" disabled={saving} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">
        {saving ? t('integrations.saving', 'Saving...') : t('integrations.save', 'Save')}
      </button>
    </form>
  </section>

  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">{t('integrations.sync', 'Sync')}</h2>
    <div class="overflow-hidden rounded-xl border border-zinc-200 bg-white divide-y divide-zinc-200 dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      <div class="flex items-center justify-between px-5 py-3">
        <span class="text-sm text-zinc-500">{t('integrations.status', 'Status')}</span>
        <span class="text-sm font-medium text-zinc-900 dark:text-white">{g.syncStatus ?? '—'}{#if g.lastSyncedAt} &middot; {fmtDate(g.lastSyncedAt)}{/if}</span>
      </div>
    </div>
    <div class="mt-4 flex gap-3">
      <form method="POST" action="?/sync" use:syncingEnhance>
        <button type="submit" disabled={syncing} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          {syncing ? t('integrations.syncing', 'Syncing...') : t('integrations.sync-from-git', 'Sync from Git')}
        </button>
      </form>
      <form method="POST" action="?/pushToGit" use:pushingEnhance>
        <button type="submit" disabled={pushing} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          {pushing ? t('integrations.pushing', 'Pushing...') : t('integrations.push-to-git', 'Push to Git')}
        </button>
      </form>
    </div>
  </section>
</div>
