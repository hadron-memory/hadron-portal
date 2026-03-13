<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  const ownerId = $derived(org.owner?.id ?? null);
  const isOwner = $derived(ownerId === data.currentUserId);

  const memberIds = $derived(new Set((org.members ?? []).map((m: { user: { id: string } }) => m.user.id)));
  const nonMembers = $derived((data.allUsers ?? []).filter((u: { id: string }) => !memberIds.has(u.id)));
  const nonOwnerMembers = $derived((org.members ?? []).filter((m: { user: { id: string } }) => m.user.id !== ownerId));

  const pendingInvites = $derived((data.invites ?? []).filter((i: { status: string }) => i.status === 'PENDING'));

  const canInvite = $derived(data.canInvite);

  let showTransferModal = $state(false);
  let transferTargetId = $state('');
  let linkCopied = $state(false);

  function submitOnChange(e: Event) {
    (e.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }
</script>

<svelte:head><title>Members · {org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div>
    <a href="/app/orgs/{org.id}" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← {org.name}</a>
    <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Members</h1>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Member list -->
  <section class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
    {#each (org.members ?? []) as m (m.id)}
      {@const isMemberOwner = m.user.id === ownerId}
      <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
        {#if m.user.avatarUrl}
          <img src={m.user.avatarUrl} alt={m.user.login} class="h-8 w-8 rounded-full" />
        {/if}
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <p class="font-medium text-zinc-900 truncate dark:text-white">{m.user.name ?? m.user.login}</p>
            {#if isMemberOwner}
              <span class="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">Owner</span>
            {/if}
          </div>
          <p class="text-xs text-zinc-500">@{m.user.login}</p>
        </div>

        {#if isMemberOwner}
          <!-- Owner: no role change or remove -->
          <span class="text-xs text-zinc-500">Owner</span>
        {:else}
          <!-- Role update -->
          <form method="POST" action="?/update" use:enhance class="flex items-center gap-2">
            <input type="hidden" name="userId" value={m.user.id} />
            <select name="role" onchange={submitOnChange} class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
              {#each ['READER', 'CONTRIBUTOR', 'ADMIN'] as role}
                <option value={role} selected={m.role === role}>{role}</option>
              {/each}
            </select>
          </form>
          <!-- Remove -->
          <form method="POST" action="?/remove" use:enhance>
            <input type="hidden" name="userId" value={m.user.id} />
            <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
          </form>
        {/if}
      </div>
    {/each}
  </section>

  <!-- Invite by email -->
  {#if isOwner || canInvite}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Invite by email</h2>
      <form method="POST" action="?/invite" use:enhance class="flex items-end gap-3">
        <div class="flex-1">
          <label for="inviteEmail" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Email address</label>
          <input
            id="inviteEmail"
            name="email"
            type="email"
            required
            placeholder="user@example.com"
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-600"
          />
        </div>
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Send invite</button>
      </form>

      {#if form?.inviteLink}
        <div class="mt-4 rounded-lg border border-green-800 bg-green-950 px-4 py-3">
          <p class="mb-2 text-sm font-medium text-green-300">Invitation link created (expires in 1 week):</p>
          <div class="flex items-center gap-2">
            <code class="flex-1 truncate rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-200">{form.inviteLink}</code>
            <button
              type="button"
              onclick={() => { navigator.clipboard.writeText(form.inviteLink); linkCopied = true; setTimeout(() => linkCopied = false, 2000); }}
              class="shrink-0 rounded-lg border border-zinc-600 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:bg-zinc-800"
            >{linkCopied ? 'Copied!' : 'Copy'}</button>
          </div>
        </div>
      {/if}
    </section>
  {/if}

  <!-- Pending invites -->
  {#if pendingInvites.length > 0}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Pending invites</h2>
      <div class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
        {#each pendingInvites as invite (invite.id)}
          <div class="flex items-center justify-between bg-white px-5 py-3 dark:bg-zinc-900">
            <div>
              <p class="text-sm font-medium text-zinc-900 dark:text-white">{invite.email}</p>
              <p class="text-xs text-zinc-500">Invited by @{invite.invitedBy.login} · {new Date(invite.createdAt).toLocaleDateString()}{#if invite.expiresAt} · Expires {new Date(invite.expiresAt).toLocaleDateString()}{/if}</p>
            </div>
            {#if isOwner || canInvite}
              <form method="POST" action="?/cancelInvite" use:enhance>
                <input type="hidden" name="inviteId" value={invite.id} />
                <button type="submit" class="text-xs text-red-400 hover:text-red-300">Cancel</button>
              </form>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Add existing user -->
  {#if nonMembers.length > 0}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Add existing user</h2>
      <form method="POST" action="?/add" use:enhance class="flex items-end gap-3">
        <div class="flex-1">
          <label for="userId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">User</label>
          <select id="userId" name="userId" class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            {#each nonMembers as u (u.id)}
              <option value={u.id}>{u.name ?? u.login} (@{u.login})</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="role" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="role" name="role" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="READER">Reader</option>
            <option value="CONTRIBUTOR">Contributor</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Add</button>
      </form>
    </section>
  {/if}

  <!-- Transfer ownership (owner only) -->
  {#if isOwner && nonOwnerMembers.length > 0}
    <section class="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
      <h2 class="font-semibold text-amber-900 dark:text-amber-200">Transfer ownership</h2>
      <p class="mt-1 text-sm text-amber-700 dark:text-amber-400">Transfer organization ownership to another member. You will become an Admin.</p>
      <div class="mt-4 flex items-end gap-3">
        <div class="flex-1">
          <label for="transferTarget" class="mb-1 block text-xs text-amber-700 dark:text-amber-400">New owner</label>
          <select
            id="transferTarget"
            bind:value={transferTargetId}
            class="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-amber-800 dark:bg-amber-950 dark:text-white"
          >
            <option value="">Select a member...</option>
            {#each nonOwnerMembers as m (m.user.id)}
              <option value={m.user.id}>{m.user.name ?? m.user.login} (@{m.user.login})</option>
            {/each}
          </select>
        </div>
        <button
          type="button"
          disabled={!transferTargetId}
          onclick={() => (showTransferModal = true)}
          class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >Transfer</button>
      </div>
    </section>
  {/if}

  <!-- Transfer confirmation modal -->
  {#if showTransferModal}
    {@const target = nonOwnerMembers.find((m: { user: { id: string } }) => m.user.id === transferTargetId)}
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div class="mx-4 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
        <h3 class="text-lg font-bold text-zinc-900 dark:text-white">Confirm ownership transfer</h3>
        <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Are you sure you want to transfer ownership of <strong>{org.name}</strong> to
          <strong>{target?.user.name ?? target?.user.login}</strong>? You will become an Admin.
        </p>
        <div class="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onclick={() => (showTransferModal = false)}
            class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >Cancel</button>
          <form method="POST" action="?/transferOwnership" use:enhance>
            <input type="hidden" name="newOwnerId" value={transferTargetId} />
            <button
              type="submit"
              onclick={() => (showTransferModal = false)}
              class="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500"
            >Confirm transfer</button>
          </form>
        </div>
      </div>
    </div>
  {/if}
</div>
