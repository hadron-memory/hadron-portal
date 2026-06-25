<script lang="ts">
  import { enhance } from '$app/forms';
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import SelectUser from '$lib/components/SelectUser.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { OrgMember } from '$lib/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
  const members = $derived((org.members ?? []) as OrgMember[]);

  const isOwner = $derived(members.some((m) => m.role === 'OWNER' && m.user.id === data.currentUserId));
  const ownerCount = $derived(members.filter((m) => m.role === 'OWNER').length);
  const memberCount = $derived(members.length);
  const isOnlyOwner = $derived(isOwner && ownerCount === 1);
  const isOnlyMember = $derived(memberCount === 1);

  // Display name: prefer the real name, then GitHub handle, Hadron handle,
  // email, finally the opaque id so a row is never blank.
  function memberName(m: OrgMember): string {
    return m.user.name || m.user.githubUsername || m.user.handle || m.user.email || m.user.id;
  }
  // User URN is `hrn:user:<handle>`; only users with a handle have one.
  function memberUrn(m: OrgMember): string {
    return m.user.handle ? `hrn:user:${m.user.handle}` : '';
  }

  let globalFilter = $state('');

  const columns: ColumnDef<OrgMember>[] = [
    { accessorFn: memberName, id: 'name', header: t('org-members.column.name', 'Member'), enableHiding: false, size: 280 }, // identity column (name + URN)
    { accessorFn: (m) => m.user.email ?? '', id: 'email', header: t('org-members.column.email', 'Email'), size: 240 },
    { accessorKey: 'role', header: t('org-members.column.role', 'Role'), size: 150 },
    { id: 'actions', header: t('org-members.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 120 },
  ];

  const ROLES = ['READER', 'CONTRIBUTOR', 'ADMIN', 'OWNER'] as const;

  const table = createSvelteTable<OrgMember>({
    get data() {
      return members;
    },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === 'function' ? u(globalFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

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

  <!-- Member list — TanStack grid, same chrome as the org apps/agents lists. -->
  {#if members.length === 0}
    <p class="text-sm text-zinc-500">No members.</p>
  {:else}
    <DataTable
      {table}
      listKey="orgs:members"
      searchPlaceholder={t('org-members.search.placeholder', 'Search members...')}
      searchAriaLabel={t('org-members.search.aria-label', 'Search members')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 24rem))"
    >
      {#snippet cell(cell, m)}
        {#if cell.column.id === 'name'}
          <div class="flex min-w-0 items-center gap-3">
            {#if m.user.avatarUrl}
              <img src={m.user.avatarUrl} alt="" class="h-8 w-8 shrink-0 rounded-full" />
            {/if}
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <span class="truncate font-medium text-zinc-900 dark:text-white">{memberName(m)}</span>
                {#if m.role === 'OWNER'}
                  <span class="shrink-0 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300">Owner</span>
                {/if}
              </div>
              {#if m.user.handle}
                <div class="mt-0.5 flex min-w-0"><Urn value={memberUrn(m)} type="user" size={8} /></div>
              {/if}
            </div>
          </div>
        {:else if cell.column.id === 'email'}
          {#if m.user.email}
            <div class="truncate text-zinc-600 dark:text-zinc-400">{m.user.email}</div>
          {:else}
            <span class="text-xs text-zinc-500">—</span>
          {/if}
        {:else if cell.column.id === 'role'}
          {#if isOwner && m.user.id !== data.currentUserId}
            <form method="POST" action="?/update" use:enhance>
              <input type="hidden" name="userId" value={m.user.id} />
              <label class="sr-only" for="role-{m.id}">Role for {memberName(m)}</label>
              <select id="role-{m.id}" name="role" value={m.role} onchange={submitOnChange}
                class="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">
                {#each ROLES as role}
                  <option value={role}>{role}</option>
                {/each}
              </select>
            </form>
          {:else}
            <span class="text-xs text-zinc-500">{m.role}</span>
          {/if}
        {:else if cell.column.id === 'actions'}
          {#if isOwner && m.user.id !== data.currentUserId}
            <form method="POST" action="?/remove" use:enhance
              onsubmit={(e) => { if (!confirm(`Remove ${memberName(m)} from "${org.name}"?`)) e.preventDefault(); }}>
              <input type="hidden" name="userId" value={m.user.id} />
              <button type="submit" class="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">Remove</button>
            </form>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  {/if}

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
            class="w-full truncate rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm hover:bg-zinc-50 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 {selectedUser ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-500'}"
          >
            {selectedUser ? selectedUserLabel : 'Select a user...'}
          </button>
          <input type="hidden" name="userId" value={selectedUserId} />
        </div>
        <div>
          <label for="role" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="role" name="role" class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
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
