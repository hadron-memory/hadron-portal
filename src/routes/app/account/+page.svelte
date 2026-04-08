<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const user = $derived(data.user);
  let isEditing = $state(false);
  let inviteOpen = $state(false);

  const inputClass = "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500";
</script>

<svelte:head><title>Account · Hadron</title></svelte:head>

<div class="max-w-lg space-y-8">
  <div>
    <Breadcrumb items={[
      { label: 'Dashboard', href: '/app/dashboard' },
      { label: 'Account' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">Account</h1>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}
  {#if form?.success}
    <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">Profile updated.</div>
  {/if}

  <!-- Profile -->
  <section>
    <div class="mb-4 flex items-center justify-between">
      <h2 class="font-semibold text-zinc-900 dark:text-white">Profile</h2>
      {#if !isEditing}
        <button onclick={() => isEditing = true} class="rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800">Edit</button>
      {/if}
    </div>

    {#if isEditing}
      <form method="POST" action="?/update" use:enhance={() => { return async ({ update }) => { isEditing = false; await update(); }; }}
        class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4"
      >
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
          <input id="editName" name="name" type="text" value={user?.name ?? ''} placeholder="Your display name"
            class={inputClass} />
        </div>

        <div>
          <label for="editHandle" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Handle</label>
          <div class="flex items-stretch">
            <span class="inline-flex items-center rounded-l-lg border border-r-0 border-zinc-300 bg-zinc-100 px-3 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400">@</span>
            <input id="editHandle" name="handle" type="text" value={user?.handle ?? user?.githubUsername ?? ''} placeholder="username"
              class="w-full rounded-r-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500" />
          </div>
          <p class="mt-1 text-xs text-zinc-500">Used for attribution in discussions and node authorship.</p>
        </div>

        <div>
          <label for="editEmail" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
          <input id="editEmail" name="email" type="email" value={user?.email ?? ''} placeholder="you@example.com"
            class={inputClass} />
        </div>

        <div class="flex gap-3">
          <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Save</button>
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

  <!-- Invite a user (collapsed by default) -->
  <section>
    <button onclick={() => inviteOpen = !inviteOpen} class="flex items-center gap-2 font-semibold text-zinc-900 dark:text-white">
      <svg width="12" height="12" viewBox="0 0 12 12" class="transition-transform {inviteOpen ? 'rotate-90' : ''}">
        <path d="M4 2 L8 6 L4 10" stroke="currentColor" fill="none" stroke-width="1.5" />
      </svg>
      Invite a user
    </button>

    {#if inviteOpen || (form as any)?.invited}
      <p class="mt-3 mb-3 text-sm text-zinc-500">Invite someone to join Hadron. They'll get their own account and personal workspace — no organization required.</p>

      {#if (form as any)?.invited}
        <div class="mb-4 rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
          <p class="mb-1">Invitation created! Share this link:</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 rounded bg-zinc-800 px-3 py-1.5 font-mono text-xs text-green-200 select-all break-all">{(form as any).inviteUrl}</code>
            <button onclick={() => navigator.clipboard.writeText((form as any)?.inviteUrl ?? '')} class="shrink-0 rounded-md border border-green-700 px-2 py-1 text-xs text-green-300 hover:bg-green-900">Copy</button>
          </div>
          <p class="mt-2 text-xs text-green-400">Valid for 30 days, single use.</p>
        </div>
      {/if}

      <form method="POST" action="?/invite" use:enhance class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900 space-y-4">
        <div>
          <label for="inviteName" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Name <span class="text-zinc-500">(optional)</span></label>
          <input id="inviteName" name="inviteName" type="text" placeholder="Their name"
            class={inputClass} />
        </div>
        <div>
          <label for="inviteEmail" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email <span class="text-zinc-500">(optional)</span></label>
          <input id="inviteEmail" name="inviteEmail" type="email" placeholder="them@example.com"
            class={inputClass} />
          <p class="mt-1 text-xs text-zinc-500">If provided, only this email can accept the invite.</p>
        </div>
        <div>
          <label for="inviteGithub" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">GitHub username <span class="text-zinc-500">(optional)</span></label>
          <input id="inviteGithub" name="inviteGithub" type="text" placeholder="github-username"
            class={inputClass} />
          <p class="mt-1 text-xs text-zinc-500">If provided, only this GitHub user can accept the invite.</p>
        </div>
        <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">Create invitation</button>
      </form>
    {/if}
  </section>

  <!-- Sign out -->
  <section>
    <a href="/auth/signout" data-sveltekit-reload class="inline-block rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
      Sign out
    </a>
  </section>
</div>
