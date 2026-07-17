<script lang="ts">
  // #336: Profile tab of the org-detail tab layout. The org name + URN live in
  // the layout header; this page is the overview — the org properties box and
  // subscribed memories. Memories / Agents / Apps / Team / Integrations / Usage
  // each have their own tab now.
  // #364: the Memories/Agents/Apps quick-stat cards were removed — those
  // sections own their tabs (and the count surfaced apps via an overfetch).
  // #394: the Profile tab now also shows the org's core properties and lets an
  // org ADMIN/OWNER edit them inline (name, URN slug). #609: the isVisible
  // control was removed — it is a system-managed listing flag (set on org-mode
  // activation), not a user-facing public/private toggle.
  // The Team members preview was dropped — the member count is now a field in
  // the properties box (linking to the Team tab); Team owns the full list.
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Urn from '$lib/components/Urn.svelte';
  import { parseDisplayUrn } from '$lib/urn/parse-urn';
  import { t } from '$lib/i18n/t';
  import type { PageData, ActionData } from './$types';
  import { orgProfileSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  // The GraphQL `org.urn` is the canonical `hrn:org:<slug>` form, but the
  // server stores (and updateOrganization expects) the BARE slug. Editing the
  // canonical form and submitting it raw would set the org urn to
  // `hrn:org:<slug>` and cascade that wrong prefix into every child
  // memory/agent/app urn (the #394 corruption). Always edit + submit the bare
  // slug. parseDisplayUrn is idempotent on an already-bare value.
  const urnSlug = $derived(parseDisplayUrn(org.urn, 'org').bareValue);

  // Edit affordance is admin-only (the server enforces the real ADMIN gate on
  // the `update` action; this just hides the controls from non-admins). OWNER
  // outranks ADMIN, so either may edit.
  const canEdit = $derived(
    (org.members ?? []).some(
      (m) => m.user.id === data.currentUserId && (m.role === 'OWNER' || m.role === 'ADMIN'),
    ),
  );

  const initialProfileForm = untrack(() => form?.form ?? data.form);
  const {
    form: profileForm,
    errors: profileErrors,
    constraints: profileConstraints,
    message: profileMessage,
    allErrors: profileAllErrors,
    submitting: profileSubmitting,
    enhance: profileEnhance,
  } = superForm(initialProfileForm, {
    validators: zod4Client(orgProfileSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });

  let isEditing = $state(untrack(() => !!form?.form && form.form.message !== 'Changes saved.'));
  const orgUrnError = $derived($profileErrors.urn?.[0] ?? null);
  const profileActionError = $derived(
    typeof $profileMessage === 'string' && $profileMessage !== 'Changes saved.'
      ? $profileMessage
      : ($profileAllErrors[0]?.messages[0] ?? null),
  );

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function openEdit() {
    profileForm.update((current) => ({ ...current, name: org.name, urn: urnSlug }), { taint: false });
    isEditing = true;
  }

  $effect(() => {
    if ($profileMessage === 'Changes saved.') isEditing = false;
  });
</script>

<svelte:head><title>{org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <!-- Action feedback -->
  {#if $profileMessage === 'Changes saved.' && !isEditing}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{t('org-detail.profile.saved', 'Changes saved.')}</div>
  {/if}

  <!-- Organization properties (#394) -->
  <section class="max-w-lg">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('org-detail.profile.heading', 'Organization')}</h2>
      {#if canEdit && !isEditing}
        <button onclick={openEdit} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">{t('org-detail.profile.edit', 'Edit')}</button>
      {/if}
    </div>

    {#if isEditing}
      <form method="POST" action="?/update" use:profileEnhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4" novalidate>
        {#if profileActionError}
          <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{profileActionError}</div>
        {/if}
        <div>
          <label for="orgName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('org-detail.profile.name', 'Name')}</label>
          <input id="orgName" name="name" type="text" bind:value={$profileForm.name} {...$profileConstraints.name} class={inputClass} />
        </div>
        <div>
          <label for="orgUrn" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('org-detail.profile.urn', 'URN')}</label>
          <input id="orgUrn" name="urn" type="text" bind:value={$profileForm.urn}
            aria-invalid={!!orgUrnError}
            aria-describedby={orgUrnError ? 'orgUrnError' : 'orgUrnWarning'}
            {...$profileConstraints.urn}
            class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {orgUrnError ? 'border-red-500 focus:border-red-500' : ''}" />
          {#if orgUrnError}
            <p id="orgUrnError" class="mt-1 text-xs text-red-600 dark:text-red-400">{t('org-detail.profile.urn-error', orgUrnError)}</p>
          {:else}
            <p id="orgUrnWarning" class="mt-1 text-xs text-amber-600 dark:text-amber-400">{t('org-detail.profile.urn-warning', 'Changing the URN also rewrites it across every memory, agent, and app in this organization.')}</p>
          {/if}
        </div>
        <div class="flex gap-3">
          <button type="submit" disabled={$profileSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">{$profileSubmitting ? t('org-detail.profile.saving', 'Saving...') : t('org-detail.profile.save', 'Save')}</button>
          <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">{t('org-detail.profile.cancel', 'Cancel')}</button>
        </div>
      </form>
    {:else}
      <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 divide-y divide-zinc-200 dark:divide-zinc-800 overflow-hidden">
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">{t('org-detail.profile.name', 'Name')}</span>
          <span class="text-sm font-medium text-zinc-900 dark:text-white">{org.name}</span>
        </div>
        <div class="px-5 py-3">
          <span class="text-sm text-zinc-500">{t('org-detail.profile.urn', 'URN')}</span>
          <div class="mt-1"><Urn value={org.urn} type="org" size={10} /></div>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">{t('org-detail.profile.members', 'Members')}</span>
          <a href="/app/orgs/{org.id}/members" class="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">{org.members?.length ?? 0}</a>
        </div>
        <div class="flex items-center justify-between px-5 py-3">
          <span class="text-sm text-zinc-500">{t('org-detail.profile.created', 'Created')}</span>
          <span class="text-sm text-zinc-900 dark:text-white">{new Date(org.createdAt).toLocaleDateString()}</span>
        </div>
      </div>
    {/if}
  </section>

  <!-- Subscribed memories -->
  {#if org.subscriptions?.length}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Subscribed memories <span class="ml-1 text-sm font-normal text-zinc-500">({org.subscriptions.length})</span></h2>
      <div class="grid gap-3 sm:grid-cols-2">
        {#each org.subscriptions as s (s.id)}
          <div class="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <p class="text-sm font-medium text-indigo-600 dark:text-indigo-300">{s.memory.name}</p>
            <Urn value={s.memory.urn} type="memory" size={10} />
            <p class="mt-1 text-xs text-zinc-500">Role: {s.role}</p>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
