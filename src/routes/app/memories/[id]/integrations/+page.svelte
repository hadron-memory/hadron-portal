<script lang="ts">
  import { formatPortalDate } from '$lib/format-portal-date';
  // #266: Integrations tab — GitHub source + branches and the sync/push actions,
  // split out of the Settings page.
  import { t } from '$lib/i18n/t';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import type { PageData, ActionData } from './$types';
  import {
    memoryIntegrationSchema,
    pushMemoryIntegrationSchema,
    syncMemoryIntegrationSchema,
  } from './schema';
  import SyncReportDetail from '$lib/components/SyncReportDetail.svelte';
  import SyncErrorDetail from '$lib/components/SyncErrorDetail.svelte';

  type MemoryIntegrationForm = Infer<typeof memoryIntegrationSchema, 'zod4'>;
  type PushMemoryIntegrationForm = Infer<typeof pushMemoryIntegrationSchema, 'zod4'>;
  type SyncMemoryIntegrationForm = Infer<typeof syncMemoryIntegrationSchema, 'zod4'>;
  type MemoryIntegrationSuperform = SuperValidated<MemoryIntegrationForm, App.Superforms.Message, MemoryIntegrationForm>;
  type PushMemoryIntegrationSuperform = SuperValidated<PushMemoryIntegrationForm, App.Superforms.Message, PushMemoryIntegrationForm>;
  type SyncMemoryIntegrationSuperform = SuperValidated<SyncMemoryIntegrationForm, App.Superforms.Message, SyncMemoryIntegrationForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);

  const initialIntegrationForm = untrack(() => submittedForm<MemoryIntegrationForm>(form, 'updateIntegration') as MemoryIntegrationSuperform | null ?? data.form);
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
  const initialSyncForm = untrack(() => submittedForm<SyncMemoryIntegrationForm>(form, 'syncMemory') as SyncMemoryIntegrationSuperform | null ?? data.syncForm);
  const {
    message: syncMessage,
    submitting: syncSubmitting,
    enhance: syncEnhance,
  } = superForm<SyncMemoryIntegrationForm, App.Superforms.Message, SyncMemoryIntegrationForm>(initialSyncForm, {
    validators: zod4Client(syncMemoryIntegrationSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const initialPushForm = untrack(() => submittedForm<PushMemoryIntegrationForm>(form, 'pushMemory') as PushMemoryIntegrationSuperform | null ?? data.pushForm);
  const {
    message: pushMessage,
    submitting: pushSubmitting,
    enhance: pushEnhance,
  } = superForm<PushMemoryIntegrationForm, App.Superforms.Message, PushMemoryIntegrationForm>(initialPushForm, {
    validators: zod4Client(pushMemoryIntegrationSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const sourceError = $derived($integrationErrors.source?.[0] ?? null);
  const readBranchError = $derived($integrationErrors.readBranch?.[0] ?? null);
  const writeBranchError = $derived($integrationErrors.writeBranch?.[0] ?? null);
  const actionError = $derived(scopedActionError<MemoryIntegrationForm>(form, 'updateIntegration', $integrationMessage));
  const actionSuccess = $derived(scopedActionSuccess<MemoryIntegrationForm>(form, 'updateIntegration', $integrationMessage));
  const commandError = $derived.by(() => {
    const sync = scopedActionError<SyncMemoryIntegrationForm>(form, 'syncMemory', $syncMessage);
    const push = scopedActionError<PushMemoryIntegrationForm>(form, 'pushMemory', $pushMessage);
    return sync ?? push;
  });
  const commandSuccess = $derived.by(() => {
    const sync = scopedActionSuccess<SyncMemoryIntegrationForm>(form, 'syncMemory', $syncMessage);
    const push = scopedActionSuccess<PushMemoryIntegrationForm>(form, 'pushMemory', $pushMessage);
    return sync ?? push;
  });
  const successMessage = $derived(commandSuccess ?? actionSuccess);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';


</script>

<svelte:head><title>{g.name} &middot; Integrations &middot; Hadron</title></svelte:head>

<div class="max-w-lg space-y-8">
  {#if commandError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{commandError}</div>
  {/if}
  {#if successMessage}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
      {successMessage}
    </div>
  {/if}

  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">{t('integrations.github', 'GitHub')}</h2>
    <form method="POST" action="?/update" use:integrationEnhance class="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" novalidate>
      <input type="hidden" name="_kind" value={$integrationForm._kind} />
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
        <span class="text-sm font-medium text-zinc-900 dark:text-white">{g.syncStatus ?? '—'}{#if g.lastSyncedAt} &middot; {formatPortalDate(g.lastSyncedAt)}{/if}</span>
      </div>
      <SyncReportDetail lastSyncReport={g.lastSyncReport} syncStatus={g.syncStatus} lastSyncedAt={g.lastSyncedAt} listKey="memories:integrations:sync-outcomes" />
      {#if g.syncStatus === 'ERROR'}
        <SyncErrorDetail syncError={g.syncError} />
      {/if}
    </div>
    <div class="mt-4 flex gap-3">
      <form method="POST" action="?/sync" use:syncEnhance novalidate>
        <input type="hidden" name="_kind" value="syncMemory" />
        <button type="submit" disabled={$syncSubmitting} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          {$syncSubmitting ? t('integrations.syncing', 'Syncing...') : t('integrations.sync-from-git', 'Sync from Git')}
        </button>
      </form>
      <form method="POST" action="?/pushToGit" use:pushEnhance novalidate>
        <input type="hidden" name="_kind" value="pushMemory" />
        <button type="submit" disabled={$pushSubmitting} class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:border-zinc-400 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white">
          {$pushSubmitting ? t('integrations.pushing', 'Pushing...') : t('integrations.push-to-git', 'Push to Git')}
        </button>
      </form>
    </div>
  </section>
</div>
