<script lang="ts">
  import { untrack } from 'svelte';
  import { browser } from '$app/environment';
  import { enhance } from '$app/forms';
  import { accountProfileStrings } from '$lib/i18n/account-profile-strings';
  import { deleteAccountStrings, DELETE_CONFIRMATION_TOKEN } from '$lib/i18n/delete-account-strings';
  import Urn from '$lib/components/Urn.svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PageData, ActionData } from './$types';
  import { accountProfileSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const user = $derived(data.user);
  const initialProfileForm = untrack(() => form?.form ?? data.form);
  let isEditing = $state(untrack(() => !!form?.form && form.form.message?.type !== 'success'));
  const {
    form: profileForm,
    errors: profileErrors,
    constraints: profileConstraints,
    message: profileMessage,
    allErrors: profileAllErrors,
    submitting: profileSubmitting,
    enhance: profileEnhance,
  } = superForm(initialProfileForm, {
    validators: zod4Client(accountProfileSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated({ form }) {
      if (form.message?.type === 'success') isEditing = false;
    },
  });

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";

  function currentHandle() {
    return user?.handle ?? user?.githubUsername ?? '';
  }

  function openEdit() {
    profileForm.update((current) => ({
      ...current,
      name: user?.name ?? '',
      handle: currentHandle(),
      email: user?.email ?? '',
    }), { taint: false });
    isEditing = true;
  }

  const handleError = $derived($profileErrors.handle?.[0] ?? null);
  // #1080: the email field's errors render on the field only. The banner takes
  // everything else, so a refused change isn't shown twice.
  const emailErrors = $derived($profileErrors.email ?? []);
  const emailError = $derived(emailErrors[0] ?? null);
  const profileActionError = $derived(
    $profileMessage?.type === 'error'
      ? $profileMessage.text
      : ($profileAllErrors.find((e) => e.path !== 'email')?.messages[0] ?? null),
  );

  // Danger zone (#662): single-button → expanded confirmation form (the portal
  // soft-delete pattern), hardened with a typed-DELETE gate since this delete
  // is permanent and account-wide. The disclosure is a native
  // <details>/<summary> so the POST form stays reachable without JavaScript
  // (the server re-checks the typed confirmation either way). Re-open the
  // confirmation after a native POST failure so the error shows next to the
  // form.
  const deleteError = $derived(form?.deleteError ?? null);
  const blockingOrgs = $derived(form?.blockingOrgs ?? []);
  let confirmDeleteOpen = $state(untrack(() => !!form?.deleteError));
  let deleteConfirmText = $state('');
  const deleteArmed = $derived(deleteConfirmText.trim() === DELETE_CONFIRMATION_TOKEN);
  let deleting = $state(false);
</script>

<svelte:head><title>Account · Hadron</title></svelte:head>

<div class="max-w-lg space-y-8">
  {#if $profileMessage?.type === 'success' && !isEditing}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">{$profileMessage.text}</div>
  {/if}

  <!-- Profile -->
  <section>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Profile</h2>
      {#if !isEditing}
        <button onclick={openEdit} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
      {/if}
    </div>

    {#if isEditing}
      <form method="POST" action="?/update" use:profileEnhance
        class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4"
        novalidate
      >
        {#if profileActionError}
          <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{profileActionError}</div>
        {/if}

        <div class="flex items-center gap-4 mb-2">
          {#if user?.avatarUrl}
            <img src={user.avatarUrl} alt={user?.name ?? ''} class="h-12 w-12 rounded-full" />
          {:else}
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {(user?.name ?? user?.githubUsername ?? user?.email ?? '?').charAt(0).toUpperCase()}
            </div>
          {/if}
          <p class="text-sm text-zinc-500">Avatar is managed by your identity provider.</p>
        </div>

        <div>
          <label for="editName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name</label>
          <input id="editName" name="name" type="text" bind:value={$profileForm.name} placeholder="Your display name"
            {...$profileConstraints.name}
            class={inputClass} />
        </div>

        <div>
          <label for="editHandle" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Handle</label>
          <div class="flex items-stretch">
            <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">@</span>
            <input id="editHandle" name="handle" type="text" bind:value={$profileForm.handle} placeholder="username"
              aria-invalid={!!handleError}
              aria-describedby={handleError ? 'editHandleError' : 'editHandleHelp'}
              {...$profileConstraints.handle}
              class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500 {handleError ? 'border-red-500 focus:border-red-500' : ''}" />
          </div>
          {#if handleError}
            <p id="editHandleError" class="mt-1 text-xs text-red-600 dark:text-red-400">{handleError}</p>
          {:else}
            <p id="editHandleHelp" class="mt-1 text-xs text-zinc-500">Used for attribution in discussions and node authorship.</p>
          {/if}
        </div>

        <div>
          <label for="editEmail" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
          <input id="editEmail" name="email" type="email" bind:value={$profileForm.email} placeholder="you@example.com"
            readonly
            aria-invalid={!!emailError}
            aria-describedby={emailError ? 'editEmailError' : 'editEmailHelp'}
            {...$profileConstraints.email}
            class="{inputClass} read-only:cursor-not-allowed read-only:bg-zinc-100 read-only:text-zinc-600 dark:read-only:bg-zinc-800 dark:read-only:text-zinc-400" />
          {#if emailError}
            <div id="editEmailError" class="mt-1 text-xs text-red-600 dark:text-red-400">
              {#each emailErrors as line, i (i)}<p>{line}</p>{/each}
            </div>
          {:else}
            <p id="editEmailHelp" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{accountProfileStrings.emailNotChangeable()}</p>
          {/if}
        </div>

        <div class="flex gap-3">
          <button type="submit" disabled={!!handleError || $profileSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50">{$profileSubmitting ? 'Saving...' : 'Save'}</button>
          <button type="button" onclick={() => isEditing = false} class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">Cancel</button>
        </div>
      </form>
    {:else}
      <div class="rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div class="flex items-center gap-4 px-5 py-4">
          {#if user?.avatarUrl}
            <img src={user.avatarUrl} alt={user?.name ?? ''} class="h-12 w-12 rounded-full" />
          {:else}
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300">
              {(user?.name ?? user?.githubUsername ?? user?.email ?? '?').charAt(0).toUpperCase()}
            </div>
          {/if}
          <div>
            <p class="font-medium text-zinc-900 dark:text-white">{user?.name ?? 'No name set'}</p>
            <!-- #998: the URN, not the bare handle, which the Handle row below
                 still shows. A handle-less user has no URN: nothing renders. -->
            {#if user?.urn}
              <Urn value={user.urn} type="user" />
            {/if}
          </div>
        </div>

        <div class="divide-y divide-zinc-200 border-t border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Handle</span>
            <span class="text-sm font-medium text-zinc-900 dark:text-white">{user?.handle ? `@${user.handle}` : '—'}</span>
          </div>
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Email</span>
            <span class="text-sm font-medium text-zinc-900 dark:text-white">{user?.email ?? '—'}</span>
          </div>
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">GitHub</span>
            <span class="text-sm font-medium text-zinc-900 dark:text-white">{user?.githubUsername ? `@${user.githubUsername}` : '—'}</span>
          </div>
          <div class="flex items-center justify-between px-5 py-3">
            <span class="text-sm text-zinc-500">Roles</span>
            <div class="flex gap-1">
              {#each user?.roles ?? [] as role}
                <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{role}</span>
              {/each}
            </div>
          </div>
        </div>
      </div>
    {/if}
  </section>

  <!-- Sign out -->
  <section>
    <a href="/auth/signout" data-sveltekit-reload class="inline-block rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
      Sign out
    </a>
  </section>

  <!-- Danger zone (#662): self-serve account deletion -->
  <section>
    <h2 class="mb-4 font-semibold text-red-600 dark:text-red-400">{deleteAccountStrings.heading()}</h2>
    <div class="rounded-xl border border-red-300 bg-white p-5 dark:border-red-800 dark:bg-zinc-900 space-y-4">
      <h3 class="font-medium text-zinc-900 dark:text-white">{deleteAccountStrings.cardTitle()}</h3>
      <p class="text-sm text-zinc-600 dark:text-zinc-400 leading-relaxed">
        {deleteAccountStrings.consequences()}
      </p>

      {#if deleteError}
        <div role="alert" class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
          <p>{deleteError}</p>
          {#if blockingOrgs.length > 0}
            <ul class="mt-2 list-disc space-y-1 pl-5">
              {#each blockingOrgs as org (org.id)}
                <li><a href="/app/orgs/{org.id}" class="font-medium underline hover:text-red-200">{org.name}</a></li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}

      <!-- Native disclosure: with JS disabled <summary> still toggles, so the
           POST form below stays reachable (Codex no-JS finding on #665). -->
      <details bind:open={confirmDeleteOpen}>
        <summary
          class="inline-block cursor-pointer select-none list-none rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950 [&::-webkit-details-marker]:hidden"
        >
          {deleteAccountStrings.deleteButton()}
        </summary>
        <form
          method="POST"
          action="?/deleteAccount"
          class="mt-3 space-y-3"
          use:enhance={() => {
            deleting = true;
            return async ({ update }) => {
              // Reset AFTER the action result is applied — resetting before
              // would re-enable the destructive submit mid-processing, and a
              // throwing update() would otherwise leave the button stuck on
              // "Deleting..." (Copilot finding on #665).
              try {
                await update({ reset: false });
              } finally {
                deleting = false;
              }
            };
          }}
        >
          <label for="deleteConfirm" class="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
            {deleteAccountStrings.confirmLabel()}
          </label>
          <input
            id="deleteConfirm"
            name="confirm"
            type="text"
            autocomplete="off"
            spellcheck="false"
            bind:value={deleteConfirmText}
            placeholder={DELETE_CONFIRMATION_TOKEN}
            class="w-full rounded-lg border border-red-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-red-500 focus:outline-none dark:border-red-800 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-600"
          />
          <div class="flex items-center gap-3">
            <!-- The disabled-until-typed gate is a JS-only enhancement: it must
                 not render at SSR time or a no-JS user could never submit. The
                 server action re-checks the typed confirmation regardless. -->
            <button
              type="submit"
              disabled={browser && (!deleteArmed || deleting)}
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? deleteAccountStrings.confirmSubmitting() : deleteAccountStrings.confirmSubmit()}
            </button>
            <button
              type="button"
              onclick={() => { confirmDeleteOpen = false; deleteConfirmText = ''; }}
              class="px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
            >
              {deleteAccountStrings.confirmCancel()}
            </button>
          </div>
        </form>
      </details>
    </div>
  </section>
</div>
