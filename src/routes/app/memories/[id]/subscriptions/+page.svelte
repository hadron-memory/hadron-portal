<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  // #266: Subscriptions tab — org subscriptions, split out of the Settings page.
  import { t } from '$lib/i18n/t';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import type { PageData, ActionData } from './$types';
  import SelectOrg from '$lib/components/SelectOrg.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { memorySubscriptionSchema, memoryUnsubscribeSchema } from './schema';

  type MemorySubscriptionForm = Infer<typeof memorySubscriptionSchema, 'zod4'>;
  type MemoryUnsubscribeForm = Infer<typeof memoryUnsubscribeSchema, 'zod4'>;
  type MemorySubscriptionSuperform = SuperValidated<MemorySubscriptionForm, App.Superforms.Message, MemorySubscriptionForm>;
  type MemoryUnsubscribeSuperform = SuperValidated<MemoryUnsubscribeForm, App.Superforms.Message, MemoryUnsubscribeForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const g = $derived(data.graph);
  const isAgentSystem = $derived(g.class === 'system');

  const initialSubscriptionForm = untrack(() => submittedForm<MemorySubscriptionForm>(form, 'subscribeMemory') as MemorySubscriptionSuperform | null ?? data.form);
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
  const initialUnsubscribeForm = untrack(() => submittedForm<MemoryUnsubscribeForm>(form, 'unsubscribeMemory') as MemoryUnsubscribeSuperform | null ?? data.unsubscribeForm);
  const {
    form: unsubscribeForm,
    errors: unsubscribeErrors,
    message: unsubscribeMessage,
    submitting: unsubscribeSubmitting,
    enhance: unsubscribeEnhance,
  } = superForm<MemoryUnsubscribeForm, App.Superforms.Message, MemoryUnsubscribeForm>(initialUnsubscribeForm, {
    validators: zod4Client(memoryUnsubscribeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const orgIdError = $derived($subscriptionErrors.orgId?.[0] ?? null);
  const actionError = $derived(scopedActionError<MemorySubscriptionForm>(form, 'subscribeMemory', $subscriptionMessage));
  const actionSuccess = $derived(scopedActionSuccess<MemorySubscriptionForm>(form, 'subscribeMemory', $subscriptionMessage));
  const unsubscribeActionError = $derived(scopedActionError<MemoryUnsubscribeForm>(form, 'unsubscribeMemory', $unsubscribeMessage, $unsubscribeErrors, ['orgId', '_kind']));
  const unsubscribeActionSuccess = $derived(scopedActionSuccess<MemoryUnsubscribeForm>(form, 'unsubscribeMemory', $unsubscribeMessage));

  // portal#2220: the org is picked from the orgs this caller administers (never the
  // owning org), not typed as a raw id. `targets` is a UI hint; the server's gate decides.
  let pickerOpen = $state(false);
  const selectedOrg = $derived(data.targets.find((o) => o.id === $subscriptionForm.orgId) ?? null);

  function setUnsubscribeOrg(orgId: string) {
    unsubscribeForm.update((current) => ({ ...current, orgId }), { taint: false });
  }
</script>

<svelte:head><title>{g.name} &middot; Subscriptions &middot; Hadron</title></svelte:head>

<div class="space-y-6">
  {#if unsubscribeActionError}
    <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{unsubscribeActionError}</div>
  {/if}
  <LiveRegion>
    {#if actionSuccess || unsubscribeActionSuccess}
      <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{actionSuccess ?? unsubscribeActionSuccess}</div>
    {/if}
  </LiveRegion>

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
              <!-- Keep both handlers: onclick updates before client validation for button activation;
                   onsubmit covers keyboard/requestSubmit paths. -->
              <form method="POST" action="?/unsubscribe" use:unsubscribeEnhance onsubmit={() => setUnsubscribeOrg(s.organization.id)} novalidate>
                <input type="hidden" name="_kind" value="unsubscribeMemory" />
                <input type="hidden" name="orgId" value={s.organization.id} />
                <button type="submit" disabled={$unsubscribeSubmitting} onclick={() => setUnsubscribeOrg(s.organization.id)} class="text-xs text-red-400 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-50">{t('subscriptions.remove', 'Remove')}</button>
              </form>
            </div>
          {/each}
        </div>
      {/if}

      {#if data.targets.length === 0}
        <p class="text-sm text-zinc-500">
          {t('subscriptions.no-targets', 'You do not administer another organization that could subscribe to this memory.')}
        </p>
      {:else}
      <form method="POST" action="?/subscribe" use:subscriptionEnhance class="flex max-w-md items-start gap-3" novalidate>
        <input type="hidden" name="_kind" value={$subscriptionForm._kind} />
        <div class="min-w-0 flex-1">
          <span id="subOrgLabel" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">{t('subscriptions.org', 'Organization')}</span>
          <input type="hidden" name="orgId" bind:value={$subscriptionForm.orgId} />
          {#if selectedOrg}
            <div class="min-w-0">
              <p class="text-sm font-medium text-zinc-900 dark:text-white">{selectedOrg.name}</p>
              <div class="mt-1"><Urn value={selectedOrg.urn} type="org" /></div>
            </div>
          {/if}
          <button
            id="subOrgId"
            type="button"
            aria-labelledby="subOrgLabel subOrgId"
            onclick={() => (pickerOpen = true)}
            aria-haspopup="dialog"
            aria-expanded={pickerOpen}
            aria-describedby={orgIdError ? 'subOrgIdError' : undefined}
            class="mt-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 dark:border-zinc-700 dark:text-zinc-300 {orgIdError ? 'border-red-500' : ''}"
          >{selectedOrg ? t('subscriptions.org.change', 'Change') : t('subscriptions.org.choose', 'Choose organization')}</button>
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
      <SelectOrg orgs={data.targets} bind:open={pickerOpen} onselect={(o) => { $subscriptionForm.orgId = o.id; }} />
      {/if}
    </section>
  {/if}
</div>
