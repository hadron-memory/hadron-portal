<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PageData, ActionData } from './$types';
  import { accountProfileSchema } from './schema';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const user = $derived(data.user);
  const initialProfileForm = untrack(() => form?.form ?? data.form);
  let isEditing = $state(untrack(() => !!form?.form && form.form.message !== 'Profile updated.'));
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
      if (form.message === 'Profile updated.') isEditing = false;
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
  const profileActionError = $derived(
    typeof $profileMessage === 'string' && $profileMessage !== 'Profile updated.'
      ? $profileMessage
      : ($profileAllErrors[0]?.messages[0] ?? null),
  );

</script>

<svelte:head><title>Account · Hadron</title></svelte:head>

<div class="max-w-lg space-y-8">
  {#if $profileMessage === 'Profile updated.' && !isEditing}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Profile updated.</div>
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
            {...$profileConstraints.email}
            class={inputClass} />
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
            {#if user?.handle}
              <p class="text-sm text-zinc-500">@{user.handle}</p>
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
</div>
