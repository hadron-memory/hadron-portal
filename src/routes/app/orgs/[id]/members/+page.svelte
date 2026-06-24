<script lang="ts">
  import { enhance } from '$app/forms';
  import SelectUser from '$lib/components/SelectUser.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  const isOwner = $derived((org.members ?? []).some((m: { role: string; user: { id: string } }) => m.role === 'OWNER' && m.user.id === data.currentUserId));
  const ownerCount = $derived((org.members ?? []).filter((m: { role: string }) => m.role === 'OWNER').length);
  const memberCount = $derived((org.members ?? []).length);
  const isOnlyOwner = $derived(isOwner && ownerCount === 1);
  const isOnlyMember = $derived(memberCount === 1);

  const memberIds = $derived(new Set((org.members ?? []).map((m: { user: { id: string } }) => m.user.id)));
  const nonMembers = $derived((data.allUsers ?? []).filter((u: { id: string }) => !memberIds.has(u.id)));

  // "Add existing user": the plain <select> didn't scale, so it's replaced by
  // the SelectUser modal picker (searchable, paginated) — same pattern as the
  // SelectMemory picker on the org memories subscribe form.
  let selectUserOpen = $state(false);
  let selectedUserId = $state('');
  const selectedUser = $derived(nonMembers.find((u: { id: string }) => u.id === selectedUserId));
  // Mirror SelectUser's displayName: `||` (skip empty strings) and include handle.
  const selectedUserLabel = $derived(
    selectedUser
      ? (selectedUser.name || selectedUser.githubUsername || selectedUser.handle || selectedUser.email || selectedUser.id)
      : '',
  );

  function submitOnChange(e: Event) {
    (e.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }
</script>

<svelte:head><title>Members · {org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">Team</h1>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Member list -->
  <section class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
    {#each (org.members ?? []) as m (m.id)}
      {@const isMemberOwner = m.role === 'OWNER'}
      <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
        {#if m.user.avatarUrl}
          <img src={m.user.avatarUrl} alt={m.user.name ?? m.user.githubUsername ?? m.user.email ?? ''} class="h-8 w-8 rounded-full" />
        {/if}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="font-medium text-zinc-900 truncate dark:text-white">{m.user.name ?? m.user.githubUsername ?? m.user.email}</p>
            {#if isMemberOwner}
              <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">Owner</span>
            {/if}
          </div>
          {#if m.user.githubUsername}
            <p class="text-xs text-zinc-500">@{m.user.githubUsername}</p>
          {:else if m.user.email}
            <p class="text-xs text-zinc-500">{m.user.email}</p>
          {/if}
        </div>

        {#if isOwner && m.user.id !== data.currentUserId}
          <!-- Role update (owners can change any member's role) -->
          <form method="POST" action="?/update" use:enhance class="flex items-center gap-2">
            <input type="hidden" name="userId" value={m.user.id} />
            <select name="role" onchange={submitOnChange} class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
              {#each ['READER', 'CONTRIBUTOR', 'ADMIN', 'OWNER'] as role}
                <option value={role} selected={m.role === role}>{role}</option>
              {/each}
            </select>
          </form>
          <!-- Remove -->
          <form method="POST" action="?/remove" use:enhance>
            <input type="hidden" name="userId" value={m.user.id} />
            <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
          </form>
        {:else}
          <span class="text-xs text-zinc-500">{m.role}</span>
        {/if}
      </div>
    {/each}
  </section>

  <!-- Add existing user -->
  {#if nonMembers.length > 0}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Add existing user</h2>
      <form method="POST" action="?/add" use:enhance={() => {
        return async ({ result, update }) => {
          await update();
          // Clear the picked user only on success so a failed add keeps the selection.
          if (result.type === 'success') selectedUserId = '';
        };
      }} class="flex items-end gap-3">
        <div class="flex-1">
          <label for="add-user-button" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">User</label>
          <button
            id="add-user-button"
            type="button"
            onclick={() => (selectUserOpen = true)}
            aria-haspopup="dialog"
            aria-expanded={selectUserOpen}
            class="w-full truncate rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm text-white hover:bg-zinc-800"
          >
            {selectedUser ? selectedUserLabel : 'Select a user...'}
          </button>
          <input type="hidden" name="userId" value={selectedUserId} />
        </div>
        <div>
          <label for="role" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="role" name="role" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="READER">Reader</option>
            <option value="CONTRIBUTOR">Contributor</option>
            <option value="ADMIN">Admin</option>
            <option value="OWNER">Owner</option>
          </select>
        </div>
        <button type="submit" disabled={!selectedUser} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">Add</button>
      </form>

      <SelectUser
        users={nonMembers}
        bind:open={selectUserOpen}
        onselect={(user) => (selectedUserId = user.id)}
      />
    </section>
  {/if}

  <!-- Invite new user -->
  <section>
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Invite someone new</h2>

    {#if form?.inviteUrl}
      <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
        <p class="mb-2">Invitation created! Share this link:</p>
        <code class="block rounded bg-zinc-900 px-3 py-2 text-xs text-white select-all">{form.inviteUrl}</code>
      </div>
    {:else}
      <form method="POST" action="?/invite" use:enhance class="flex flex-wrap items-end gap-3">
        <div class="flex-1 min-w-[200px]">
          <label for="inviteName" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Name <span class="text-zinc-600">(optional)</span></label>
          <input id="inviteName" name="name" type="text" placeholder="Their name"
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
        </div>
        <div class="flex-1 min-w-[200px]">
          <label for="inviteEmail" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Email <span class="text-zinc-600">(optional)</span></label>
          <input id="inviteEmail" name="email" type="email" placeholder="email@example.com"
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
        </div>
        <div>
          <label for="inviteRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="inviteRole" name="memberRole" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="READER">Reader</option>
            <option value="CONTRIBUTOR">Contributor</option>
            <option value="ADMIN">Admin</option>
            <option value="OWNER">Owner</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600">Create invite link</button>
      </form>
    {/if}
  </section>

  <!-- Leave organization -->
  {#if !isOnlyOwner}
    <section class="border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 class="mb-3 text-sm font-semibold text-red-500">Leave organization</h2>
      {#if isOnlyMember}
        <p class="mb-3 text-xs text-red-400">You are the only member. Leaving will delete the organization and all its content.</p>
      {/if}
      <form method="POST" action="?/leave" use:enhance onsubmit={(e) => {
        const msg = isOnlyMember
          ? `Leave and DELETE "${org.name}"? This will remove all memories, agents, and data. This cannot be undone.`
          : `Leave "${org.name}"? You will lose access to this organization.`;
        if (!confirm(msg)) e.preventDefault();
      }}>
        <button type="submit" class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
          {isOnlyMember ? 'Leave and delete organization' : 'Leave organization'}
        </button>
      </form>
    </section>
  {/if}
</div>
