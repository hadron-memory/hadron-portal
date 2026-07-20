<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
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
  import { type SearchUser, userLabel } from '$lib/users/search-user';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { OrgMember } from '$lib/types';
  import type { PageData, ActionData } from './$types';
  import {
    addOrgMemberSchema,
    inviteMemberSchema,
    leaveOrgSchema,
    removeOrgMemberSchema,
    updateOrgMemberSchema,
  } from './schema';

  type AddOrgMemberForm = Infer<typeof addOrgMemberSchema, 'zod4'>;
  type UpdateOrgMemberForm = Infer<typeof updateOrgMemberSchema, 'zod4'>;
  type RemoveOrgMemberForm = Infer<typeof removeOrgMemberSchema, 'zod4'>;
  type InviteMemberForm = Infer<typeof inviteMemberSchema, 'zod4'>;
  type LeaveOrgForm = Infer<typeof leaveOrgSchema, 'zod4'>;
  type AddOrgMemberSuperform = SuperValidated<AddOrgMemberForm, App.Superforms.Message, AddOrgMemberForm>;
  type UpdateOrgMemberSuperform = SuperValidated<UpdateOrgMemberForm, App.Superforms.Message, UpdateOrgMemberForm>;
  type RemoveOrgMemberSuperform = SuperValidated<RemoveOrgMemberForm, App.Superforms.Message, RemoveOrgMemberForm>;
  type InviteMemberSuperform = SuperValidated<InviteMemberForm, App.Superforms.Message, InviteMemberForm>;
  type LeaveOrgSuperform = SuperValidated<LeaveOrgForm, App.Superforms.Message, LeaveOrgForm>;

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

  // "Add existing user": the SelectUser modal searches the server on demand
  // (#414) — it no longer receives a preloaded user list. We give it a `search`
  // callback that hits /api/users/search and drops anyone already in this org.
  let selectUserOpen = $state(false);
  let selectedUser = $state<SearchUser | null>(null);
  const selectedUserLabel = $derived(selectedUser ? userLabel(selectedUser) : '');

  const memberIdSet = $derived(new Set(members.map((m) => m.user.id)));

  async function searchUsers(query: string): Promise<SearchUser[]> {
    const res = await fetch('/api/users/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) throw new Error('Search failed');
    const data = (await res.json()) as { users?: SearchUser[] };
    // Hide users already in this org — they can't be added again.
    return (data.users ?? []).filter((u) => !memberIdSet.has(u.id));
  }

  function submitOnChange(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const userId = select.dataset.userId ?? '';
    updateForm.update(
      (current) => ({
        ...current,
        userId,
        role: select.value as UpdateOrgMemberForm['role'],
      }),
      { taint: false },
    );
    select.form?.requestSubmit();
  }

  function submittedForm<T extends { _kind?: string }>(
    actionData: ActionData,
    kind: T['_kind'],
  ): SuperValidated<T, App.Superforms.Message, T> | null {
    const candidate = actionData && 'form' in actionData ? actionData.form : null;
    const candidateData = candidate?.data;
    const candidateKind = candidateData && typeof candidateData === 'object' && '_kind' in candidateData
      ? String(candidateData._kind)
      : null;
    return candidateKind === kind
      ? candidate as unknown as SuperValidated<T, App.Superforms.Message, T>
      : null;
  }

  const initialAddForm = untrack(() => submittedForm<AddOrgMemberForm>(form, 'addOrgMember') as AddOrgMemberSuperform | null ?? data.addForm);
  const {
    form: addForm,
    errors: addErrors,
    constraints: addConstraints,
    message: addMessage,
    submitting: addSubmitting,
    enhance: addEnhance,
  } = superForm<AddOrgMemberForm, App.Superforms.Message, AddOrgMemberForm>(initialAddForm, {
    validators: zod4Client(addOrgMemberSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.message?.type === 'success') {
        selectedUser = null;
        addForm.update((current) => ({ ...current, userId: '' }), { taint: false });
      }
    },
  });
  const addUserError = $derived($addErrors.userId?.[0] ?? null);
  const addRoleError = $derived($addErrors.role?.[0] ?? null);
  const addKindError = $derived($addErrors._kind?.[0] ?? null);
  const addActionError = $derived(
    $addMessage?.type === 'error'
      ? $addMessage.text
      : addUserError ?? addRoleError ?? addKindError,
  );
  const addActionSuccess = $derived($addMessage?.type === 'success' ? $addMessage.text : null);

  const initialUpdateForm = untrack(() => submittedForm<UpdateOrgMemberForm>(form, 'updateOrgMember') as UpdateOrgMemberSuperform | null ?? data.updateForm);
  const {
    form: updateForm,
    errors: updateErrors,
    message: updateMessage,
    enhance: updateEnhance,
  } = superForm<UpdateOrgMemberForm, App.Superforms.Message, UpdateOrgMemberForm>(initialUpdateForm, {
    validators: zod4Client(updateOrgMemberSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const updateActionError = $derived(
    $updateMessage?.type === 'error'
      ? $updateMessage.text
      : $updateErrors.userId?.[0] ?? $updateErrors.role?.[0] ?? $updateErrors._kind?.[0] ?? null,
  );
  const updateActionSuccess = $derived($updateMessage?.type === 'success' ? $updateMessage.text : null);

  const initialRemoveForm = untrack(() => submittedForm<RemoveOrgMemberForm>(form, 'removeOrgMember') as RemoveOrgMemberSuperform | null ?? data.removeForm);
  const {
    form: removeForm,
    errors: removeErrors,
    message: removeMessage,
    enhance: removeEnhance,
  } = superForm<RemoveOrgMemberForm, App.Superforms.Message, RemoveOrgMemberForm>(initialRemoveForm, {
    validators: zod4Client(removeOrgMemberSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const removeActionError = $derived(
    $removeMessage?.type === 'error'
      ? $removeMessage.text
      : $removeErrors.userId?.[0] ?? $removeErrors._kind?.[0] ?? null,
  );
  const removeActionSuccess = $derived($removeMessage?.type === 'success' ? $removeMessage.text : null);

  const initialInviteForm = untrack(() => submittedForm<InviteMemberForm>(form, 'inviteOrgMember') as InviteMemberSuperform | null ?? data.inviteForm);
  const {
    form: inviteForm,
    errors: inviteErrors,
    constraints: inviteConstraints,
    message: inviteMessage,
    submitting: inviteSubmitting,
    enhance: inviteEnhance,
  } = superForm(initialInviteForm, {
    validators: zod4Client(inviteMemberSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const inviteNameError = $derived($inviteErrors.name?.[0] ?? null);
  const inviteEmailError = $derived($inviteErrors.email?.[0] ?? null);
  const inviteKindError = $derived($inviteErrors._kind?.[0] ?? null);
  const inviteFormError = $derived($inviteErrors._errors?.[0] ?? null);
  const inviteActionError = $derived(
    $inviteMessage?.type === 'error' ? $inviteMessage.text : inviteFormError ?? inviteKindError,
  );
  const inviteValid = $derived(
    ($inviteForm.name.trim() !== '' || $inviteForm.email.trim() !== '') &&
      !inviteFormError &&
      !inviteNameError &&
      !inviteEmailError,
  );

  const initialLeaveForm = untrack(() => submittedForm<LeaveOrgForm>(form, 'leaveOrg') as LeaveOrgSuperform | null ?? data.leaveForm);
  const {
    errors: leaveErrors,
    message: leaveMessage,
    enhance: leaveEnhance,
  } = superForm<LeaveOrgForm, App.Superforms.Message, LeaveOrgForm>(initialLeaveForm, {
    validators: zod4Client(leaveOrgSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const leaveActionError = $derived(
    $leaveMessage?.type === 'error' ? $leaveMessage.text : $leaveErrors._kind?.[0] ?? null,
  );

  function selectAddUser(user: SearchUser) {
    selectedUser = user;
    addForm.update((current) => ({ ...current, userId: user.id }), { taint: false });
  }

  function setRemoveUser(userId: string) {
    removeForm.update((current) => ({ ...current, userId }), { taint: false });
  }

  // Brief "Copied!" confirmation on the invite-link copy button.
  let inviteCopied = $state(false);
  let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
  async function copyInviteLink(link: string) {
    // Bail before showing "Copied!" if the Clipboard API isn't available
    // (insecure context / old browser) — the link stays select-all so the user
    // can still copy it manually, and we don't claim a copy that didn't happen.
    if (typeof navigator.clipboard?.writeText !== 'function') return;
    try {
      await navigator.clipboard.writeText(link);
      inviteCopied = true;
      clearTimeout(copyResetTimer);
      copyResetTimer = setTimeout(() => (inviteCopied = false), 2000);
    } catch {
      // Write rejected (e.g. permission denied) — leave the UI unchanged.
    }
  }
</script>

<svelte:head><title>Members · {org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <!-- Visually redundant with the active "Team" tab, but kept as an sr-only H1
       so the route still has exactly one top-level heading for the a11y tree /
       document outline (per the caption-ownership convention; PR #378). -->
  <h1 class="sr-only">Team</h1>

  {#if updateActionError || removeActionError || leaveActionError}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">
      {updateActionError ?? removeActionError ?? leaveActionError}
    </div>
  {:else if updateActionSuccess || removeActionSuccess}
    <div class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
      {updateActionSuccess ?? removeActionSuccess}
    </div>
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
              <span class="block truncate font-medium text-zinc-900 dark:text-white">{memberName(m)}</span>
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
            <form method="POST" action="?/update" use:updateEnhance>
              <input type="hidden" name="_kind" value="updateOrgMember" />
              <input type="hidden" name="userId" value={m.user.id} />
              <label class="sr-only" for="role-{m.id}">Role for {memberName(m)}</label>
              <select id="role-{m.id}" name="role" value={m.role} data-user-id={m.user.id} onchange={submitOnChange}
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
            <!-- Keep both handlers: onclick updates before client validation for button activation;
                 onsubmit covers keyboard/requestSubmit paths and the confirmation. -->
            <form method="POST" action="?/remove" use:removeEnhance
              onsubmit={(e) => {
                setRemoveUser(m.user.id);
                if (!confirm(`Remove ${memberName(m)} from "${org.name}"?`)) e.preventDefault();
              }}>
              <input type="hidden" name="_kind" value="removeOrgMember" />
              <input type="hidden" name="userId" value={m.user.id} />
              <button type="submit" onclick={() => setRemoveUser(m.user.id)} class="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950">Remove</button>
            </form>
          {/if}
        {/if}
      {/snippet}
    </DataTable>
  {/if}

  <!-- Add existing user -->
  <section class="max-w-2xl">
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Add existing user</h2>
    <form method="POST" action="?/add" use:addEnhance class="flex flex-wrap items-start gap-3" novalidate>
      {#if addActionError}
        <div class="basis-full rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{addActionError}</div>
      {:else if addActionSuccess}
        <div class="basis-full rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">{addActionSuccess}</div>
      {/if}
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
          {selectedUser ? selectedUserLabel : 'Find a user...'}
        </button>
        <input type="hidden" name="_kind" value="addOrgMember" />
        <input type="hidden" name="userId" bind:value={$addForm.userId} {...$addConstraints.userId} />
        {#if addUserError}
          <p class="mt-1 text-xs text-red-600 dark:text-red-400">{addUserError}</p>
        {/if}
      </div>
      <div>
          <label for="role" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="role" name="role"
            bind:value={$addForm.role}
            aria-invalid={!!addRoleError}
            aria-describedby={addRoleError ? 'addRoleError' : undefined}
            class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
            <option value="READER">Reader</option>
            <option value="CONTRIBUTOR">Contributor</option>
            <option value="ADMIN">Admin</option>
            <option value="OWNER">Owner</option>
          </select>
          {#if addRoleError}
            <p id="addRoleError" class="mt-1 text-xs text-red-600 dark:text-red-400">{addRoleError}</p>
          {/if}
        </div>
        <button type="submit" disabled={$addSubmitting || !selectedUser} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">{$addSubmitting ? 'Adding...' : 'Add'}</button>
      </form>

      <SelectUser
        search={searchUsers}
        bind:open={selectUserOpen}
        onselect={selectAddUser}
      />
  </section>

  <!-- Invite new user -->
  <section class="max-w-2xl">
    <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Invite someone new</h2>

    {#if form?.inviteUrl}
      <div class="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300">
        <p class="mb-1">
          {form.inviteName
            ? `This is the unique invite link for ${form.inviteName}`
            : 'This is the unique invite link for the new member'}
        </p>
        <p class="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
          It was created for this recipient only — please don't forward it to anyone else.
        </p>
        <div class="flex items-center gap-2">
          <code class="flex-1 rounded bg-zinc-100 px-3 py-2 text-xs text-zinc-900 select-all break-all dark:bg-zinc-800 dark:text-white">{form.inviteUrl}</code>
          <button
            type="button"
            onclick={() => copyInviteLink(form.inviteUrl)}
            class="shrink-0 rounded-md border border-zinc-300 px-3 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >{inviteCopied ? 'Copied!' : 'Copy'}</button>
        </div>
      </div>
    {:else}
      <form method="POST" action="?/invite" use:inviteEnhance class="flex flex-wrap items-start gap-3" novalidate>
        <input type="hidden" name="_kind" value="inviteOrgMember" />
        {#if inviteActionError}
          <div class="basis-full rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{inviteActionError}</div>
        {/if}
        <div class="flex-1 min-w-[200px]">
          <label for="inviteName" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Name <span class="text-zinc-600">(optional)</span></label>
          <input id="inviteName" name="name" type="text" placeholder="Their name"
            bind:value={$inviteForm.name}
            aria-invalid={!!inviteNameError}
            aria-describedby={inviteNameError ? 'inviteNameError' : undefined}
            {...$inviteConstraints.name}
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none {inviteNameError ? 'border-red-500 focus:border-red-500' : ''}" />
          {#if inviteNameError}
            <p id="inviteNameError" class="mt-1 text-xs text-red-600 dark:text-red-400">{inviteNameError}</p>
          {/if}
        </div>
        <div class="flex-1 min-w-[200px]">
          <label for="inviteEmail" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Email <span class="text-zinc-600">(optional)</span></label>
          <input id="inviteEmail" name="email" type="email" placeholder="email@example.com"
            bind:value={$inviteForm.email}
            aria-invalid={!!inviteEmailError}
            aria-describedby={inviteEmailError ? 'inviteEmailError' : undefined}
            {...$inviteConstraints.email}
            class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none {inviteEmailError ? 'border-red-500 focus:border-red-500' : ''}" />
          {#if inviteEmailError}
            <p id="inviteEmailError" class="mt-1 text-xs text-red-600 dark:text-red-400">{inviteEmailError}</p>
          {/if}
        </div>
        <div>
          <label for="inviteRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="inviteRole" name="memberRole" bind:value={$inviteForm.memberRole} class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="READER">Reader</option>
            <option value="CONTRIBUTOR">Contributor</option>
            <option value="ADMIN">Admin</option>
            <option value="OWNER">Owner</option>
          </select>
        </div>
        <button type="submit" disabled={!inviteValid || $inviteSubmitting} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">{$inviteSubmitting ? 'Creating...' : 'Create invite link'}</button>
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
      <form method="POST" action="?/leave" use:leaveEnhance onsubmit={(e) => {
        const msg = isOnlyMember
          ? `Leave and DELETE "${org.name}"? This will remove all memories, agents, and data. This cannot be undone.`
          : `Leave "${org.name}"? You will lose access to this organization.`;
        if (!confirm(msg)) e.preventDefault();
      }}>
        <input type="hidden" name="_kind" value="leaveOrg" />
        <button type="submit" class="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-500 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-950">
          {isOnlyMember ? 'Leave and delete organization' : 'Leave organization'}
        </button>
      </form>
    </section>
  {/if}
</div>
