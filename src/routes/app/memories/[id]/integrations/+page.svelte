<script lang="ts">
  // #266: Integrations tab — GitHub source + branches and the sync/push actions,
  // split out of the Settings page.
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n/t';
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PageData, ActionData } from './$types';
  import { memoryIntegrationSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);

  let syncing = $state(false);
  let pushing = $state(false);

  const initialIntegrationForm = untrack(() => form?.form ?? data.form);
  const {
    form: integrationForm,
    errors: integrationErrors,
    constraints: integrationConstraints,
    message: integrationMessage,
    submitting: integrationSubmitting,
    enhance: integrationEnhance,
  } = superForm(initialIntegrationForm, {
    validators: zod4Client(memoryIntegrationSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const sourceError = $derived($integrationErrors.source?.[0] ?? null);
  const readBranchError = $derived($integrationErrors.readBranch?.[0] ?? null);
  const writeBranchError = $derived($integrationErrors.writeBranch?.[0] ?? null);
  const actionError = $derived($integrationMessage?.type === 'error' ? $integrationMessage.text : null);
  const actionSuccess = $derived($integrationMessage?.type === 'success' ? $integrationMessage.text : null);
  const commandSuccess = $derived(
    form && 'synced' in form
      ? t('integrations.synced', 'Memory synced.')
      : form && 'pushed' in form
        ? t('integrations.pushed', 'Pushed to Git.')
        : null
  );
  const successMessage = $derived(commandSuccess ?? actionSuccess);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';

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
  <!-- form.error surfaces plain sync/push failures; actionError surfaces the Superforms update path. -->
  {#if form?.error}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if successMessage}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {successMessage}
    </div>
  {/if}

  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">{t('integrations.github', 'GitHub')}</h2>
    <form method="POST" action="?/update" use:integrationEnhance class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" novalidate>
      {#if actionError}
        <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{actionError}</div>
      {/if}
      <div>
        <label for="source" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">{t('integrations.source-url', 'Git source URL')}</label>
        <input
          id="source"
          name="source"
          type="text"
          bind:value={$integrationForm.source}
          placeholder="https://github.com/owner/repo.git"
          aria-invalid={!!sourceError}
          aria-describedby={sourceError ? 'sourceError' : undefined}
          {...$integrationConstraints.source}
          class="{inputClass} {sourceError ? 'border-red-500 focus:border-red-500' : ''}"
        />
        {#if sourceError}
          <p id="sourceError" class="mt-1 text-xs text-red-600 dark:text-red-400">{sourceError}</p>
        {/if}
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label for="readBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">{t('integrations.read-branch', 'Read branch')}</label>
          <input
            id="readBranch"
            name="readBranch"
            type="text"
            bind:value={$integrationForm.readBranch}
            placeholder="main"
            aria-invalid={!!readBranchError}
            aria-describedby={readBranchError ? 'readBranchError' : undefined}
            {...$integrationConstraints.readBranch}
            class="{inputClass} {readBranchError ? 'border-red-500 focus:border-red-500' : ''}"
          />
          {#if readBranchError}
            <p id="readBranchError" class="mt-1 text-xs text-red-600 dark:text-red-400">{readBranchError}</p>
          {/if}
        </div>
        <div>
          <label for="writeBranch" class="mb-1 block text-sm text-zinc-700 dark:text-zinc-300">{t('integrations.write-branch', 'Write branch')}</label>
          <input
            id="writeBranch"
            name="writeBranch"
            type="text"
            bind:value={$integrationForm.writeBranch}
            placeholder="hadron-updates"
            aria-invalid={!!writeBranchError}
            aria-describedby={writeBranchError ? 'writeBranchError' : undefined}
            {...$integrationConstraints.writeBranch}
            class="{inputClass} {writeBranchError ? 'border-red-500 focus:border-red-500' : ''}"
          />
          {#if writeBranchError}
            <p id="writeBranchError" class="mt-1 text-xs text-red-600 dark:text-red-400">{writeBranchError}</p>
          {/if}
        </div>
      </div>
      <button type="submit" disabled={$integrationSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
        {$integrationSubmitting ? t('integrations.saving', 'Saving...') : t('integrations.save', 'Save')}
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
