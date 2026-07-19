<script lang="ts">
  // #266: Subscriptions tab — org subscriptions, split out of the Settings page.
  import { enhance } from '$app/forms';
  import { t } from '$lib/i18n/t';
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PageData, ActionData } from './$types';
  import { memorySubscriptionSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);
  const isAgentSystem = $derived(g.class === 'system');

  const initialSubscriptionForm = untrack(() => form?.form ?? data.form);
  const {
    form: subscriptionForm,
    errors: subscriptionErrors,
    constraints: subscriptionConstraints,
    message: subscriptionMessage,
    submitting: subscriptionSubmitting,
    enhance: subscriptionEnhance,
  } = superForm(initialSubscriptionForm, {
    validators: zod4Client(memorySubscriptionSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const orgIdError = $derived($subscriptionErrors.orgId?.[0] ?? null);
  // $subscriptionMessage persists across actions; only show it after the Superforms subscribe action.
  const hasSubscribeActionData = $derived(!!form && 'form' in form);
  const actionError = $derived(hasSubscribeActionData && $subscriptionMessage?.type === 'error' ? $subscriptionMessage.text : null);
  const actionSuccess = $derived(hasSubscribeActionData && $subscriptionMessage?.type === 'success' ? $subscriptionMessage.text : null);

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

<svelte:head><title>{g.name} &middot; Subscriptions &middot; Hadron</title></svelte:head>

<div class="space-y-6">
  {#if form?.error}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if actionSuccess}
    <div role="status" class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{actionSuccess}</div>
  {/if}

  {#if isAgentSystem}
    <p class="text-sm text-zinc-500">{t('subscriptions.not-applicable', "Agent system memories don't support org subscriptions.")}</p>
  {:else}
    <section>
      <h2 class="mb-4 font-semibold text-zinc-900 dark:text-white">
        {t('subscriptions.heading', 'Org subscriptions')}
        <span class="ml-1 text-sm font-normal text-zinc-500">({g.subscriptions?.length ?? 0})</span>
      </h2>

      {#if g.subscriptions?.length}
        <div class="mb-4 divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {#each g.subscriptions as s (s.id)}
            <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
              <div class="flex-1">
                <p class="text-sm text-zinc-900 dark:text-white">{s.organization.name}</p>
                <p class="font-mono text-xs text-zinc-500">{s.organization.urn}</p>
              </div>
              <span class="text-xs text-zinc-500">{s.role}</span>
              <form method="POST" action="?/unsubscribe" use:enhance>
                <input type="hidden" name="orgId" value={s.organization.id} />
                <button type="submit" class="text-xs text-red-400 hover:text-red-300">{t('subscriptions.remove', 'Remove')}</button>
              </form>
            </div>
          {/each}
        </div>
      {/if}

      <form method="POST" action="?/subscribe" use:subscriptionEnhance class="flex max-w-md items-start gap-3" novalidate>
        <div class="flex-1">
          <label for="subOrgId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">{t('subscriptions.org-id', 'Organization ID')}</label>
          <input
            id="subOrgId"
            name="orgId"
            type="text"
            bind:value={$subscriptionForm.orgId}
            placeholder="org-cuid"
            aria-invalid={!!orgIdError}
            aria-describedby={orgIdError ? 'subOrgIdError' : undefined}
            {...$subscriptionConstraints.orgId}
            class="{inputClass} font-mono {orgIdError ? 'border-red-500 focus:border-red-500' : ''}"
          />
          {#if orgIdError}
            <p id="subOrgIdError" class="mt-1 text-xs text-red-600 dark:text-red-400">{orgIdError}</p>
          {/if}
          {#if actionError}
            <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{actionError}</p>
          {/if}
        </div>
        <div>
          <label for="subRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">{t('subscriptions.role', 'Role')}</label>
          <select id="subRole" name="role" bind:value={$subscriptionForm.role} class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <option value="READER">{t('subscriptions.role.reader', 'Reader')}</option>
            <option value="CONTRIBUTOR">{t('subscriptions.role.contributor', 'Contributor')}</option>
          </select>
        </div>
        <button type="submit" disabled={$subscriptionSubmitting} class="rounded-lg bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-700 dark:text-white dark:hover:bg-zinc-600">
          {$subscriptionSubmitting ? t('subscriptions.adding', 'Adding...') : t('subscriptions.add', 'Add')}
        </button>
      </form>
    </section>
  {/if}
</div>
