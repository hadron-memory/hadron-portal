<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import SelectUser from '$lib/components/SelectUser.svelte';
  import { type SearchUser, searchUsersPage, userLabel as searchUserLabel } from '$lib/users/search-user';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import type { App, AppMember } from '$lib/types';
  import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from './schema';

  type AddAppMemberForm = Infer<typeof addAppMemberSchema, 'zod4'>;
  type EnsureAppMemberForm = Infer<typeof ensureAppMemberSchema, 'zod4'>;
  type RemoveAppMemberForm = Infer<typeof removeAppMemberSchema, 'zod4'>;
  type AddAppMemberSuperform = SuperValidated<AddAppMemberForm, App.Superforms.Message, AddAppMemberForm>;
  type EnsureAppMemberSuperform = SuperValidated<EnsureAppMemberForm, App.Superforms.Message, EnsureAppMemberForm>;
  type RemoveAppMemberSuperform = SuperValidated<RemoveAppMemberForm, App.Superforms.Message, RemoveAppMemberForm>;

  /**
   * The App page's Human Team tab (#1005): the former `/app/apps/[appId]/members`
   * page, hosted in place. `form` is the page's action result, so a no-JS submit
   * that lands back here re-seeds these forms the way it did on the old page.
   */
  let { app, members, membersError, membersWithheld = false, addMemberForm, ensureMemberForm, removeMemberForm, form }: {
    app: App;
    members: AppMember[];
    membersError: boolean;
    /** portal#1148: the server WITHHOLDS the roster from this viewer — not an empty roster, not a failed fetch. */
    membersWithheld?: boolean;
    addMemberForm: AddAppMemberSuperform;
    ensureMemberForm: EnsureAppMemberSuperform;
    removeMemberForm: RemoveAppMemberSuperform;
    form: unknown;
  } = $props();

  // #653: "Add member" searches users on demand (SelectUser → /api/users/search)
  // instead of a bulk-loaded admin-only list — so a personal-app owner or
  // non-admin org member can add the first member. Selection is by opaque id.
  let selectUserOpen = $state(false);
  let selectedUser = $state<SearchUser | null>(null);
  const selectedUserLabel = $derived(selectedUser ? searchUserLabel(selectedUser) : '');
  const memberIdSet = $derived(new Set(members.map((m) => m.userId)));

  const searchUsers = (query: string) => searchUsersPage(query, memberIdSet);

  function selectAddUser(user: SearchUser) {
    selectedUser = user;
    addForm.update((current) => ({ ...current, userId: user.id }), { taint: false });
  }

  // Roles the App offers: the server's union over every installed Agent,
  // primary first (R211, hrn:node:hadronmemory.com:specs:cor:dmo:050:04). The server validates against this
  // same list, so the dropdown is the canonical source of truth. Not the
  // deprecated single `app.agent` policy: on a multi-Agent App that list is
  // incomplete (#1405). `maxMembers` below keeps its existing read.
  const memberRoles = $derived<string[]>(app.availableMemberRoles ?? []);
  const maxMembers = $derived<string>(app.agent?.installationPolicy?.maxMembers ?? 'unlimited');
  const memberLimit = $derived<number | null>(
    maxMembers === 'unlimited' ? null : Number.parseInt(maxMembers, 10),
  );
  const agentsWithheld = $derived(app.agents === null);
  const atLimit = $derived(memberLimit !== null && members.length >= memberLimit);

  // After a successful add, clear the picked user and keep a sensible role so the
  // operator can immediately add another.
  function reseedAddForm(submittedRole: string) {
    selectedUser = null;
    addForm.update(
      (current) => ({
        ...current,
        userId: '',
        role: memberRoles.includes(submittedRole) ? submittedRole : (memberRoles[0] ?? ''),
      }),
      { taint: false },
    );
  }

  const initialAddForm = untrack(() => submittedForm<AddAppMemberForm>(form, 'addAppMember') as AddAppMemberSuperform | null ?? addMemberForm);
  const {
    form: addForm,
    errors: addErrors,
    constraints: addConstraints,
    message: addMessage,
    submitting: addSubmitting,
    enhance: addEnhance,
  } = superForm(initialAddForm, {
    validators: zod4Client(addAppMemberSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.message?.type === 'success') reseedAddForm(form.data.role);
    },
  });
  const addUserError = $derived($addErrors.userId?.[0] ?? null);
  const addRoleError = $derived($addErrors.role?.[0] ?? null);
  const addActionError = $derived(
    $addMessage?.type === 'error'
      ? $addMessage.text
      : $addErrors._kind?.[0] ?? null,
  );

  const initialEnsureForm = untrack(() => submittedForm<EnsureAppMemberForm>(form, 'ensureAppMember') as EnsureAppMemberSuperform | null ?? ensureMemberForm);
  const {
    form: ensureForm,
    errors: ensureErrors,
    message: ensureMessage,
    submitting: ensureSubmitting,
    enhance: ensureEnhance,
  } = superForm<EnsureAppMemberForm, App.Superforms.Message, EnsureAppMemberForm>(initialEnsureForm, {
    validators: zod4Client(ensureAppMemberSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const ensureActionError = $derived(
    $ensureMessage?.type === 'error'
      ? $ensureMessage.text
      : $ensureErrors.userId?.[0] ?? $ensureErrors.role?.[0] ?? $ensureErrors._kind?.[0] ?? null,
  );
  const ensureActionSuccess = $derived($ensureMessage?.type === 'success' ? $ensureMessage.text : null);

  const initialRemoveForm = untrack(() => submittedForm<RemoveAppMemberForm>(form, 'removeAppMember') as RemoveAppMemberSuperform | null ?? removeMemberForm);
  const {
    form: removeForm,
    errors: removeErrors,
    message: removeMessage,
    submitting: removeSubmitting,
    enhance: removeEnhance,
  } = superForm<RemoveAppMemberForm, App.Superforms.Message, RemoveAppMemberForm>(initialRemoveForm, {
    validators: zod4Client(removeAppMemberSchema),
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

  function submitOnChange(e: Event) {
    const select = e.currentTarget as HTMLSelectElement;
    const userId = select.dataset.userId ?? '';
    ensureForm.update(
      (current) => ({
        ...current,
        userId,
        role: select.value,
      }),
      { taint: false },
    );
    select.form?.requestSubmit();
  }

  function setRemoveUser(userId: string) {
    removeForm.update((current) => ({ ...current, userId }), { taint: false });
  }

  function userLabel(u: { name: string | null; githubUsername: string | null; email?: string | null }): string {
    return u.name ?? u.githubUsername ?? u.email ?? 'Unknown';
  }
</script>

<div class="space-y-8">
  <div>
    <h2 class="text-lg font-semibold text-zinc-900 dark:text-white">
      {t('app.members.title', 'Human Team')}
      {#if !membersWithheld && !membersError}
        <span class="ml-2 text-sm font-normal text-zinc-500">({members.length}{memberLimit !== null ? ` / ${memberLimit}` : ''})</span>
      {/if}
    </h2>
    <!-- portal#1148: a null agent says nothing when the install roster is withheld. -->
    <LiveRegion>
      {#if !app.agent && agentsWithheld}
        <p class="mt-1 text-sm text-zinc-500">
          {t('app.members.agent-withheld', 'Which Agent is linked to this App isn’t visible to you.')}
        </p>
      {/if}
    </LiveRegion>
    {#if app.agent}
      <p class="mt-1 text-sm text-zinc-500">
        Roles below are defined by the linked Agent
        <a href="/app/agents/{app.agent.id}" class="text-indigo-500 hover:underline dark:text-indigo-400">{app.agent.name}</a>.
      </p>
    {:else if agentsWithheld}
      <!-- announced by the region above -->
    {:else}
      <p class="mt-1 text-sm text-amber-600 dark:text-amber-400">
        This App has no Agent linked yet. Members can only be added once an Agent is linked.
      </p>
    {/if}
  </div>

  <LiveRegion>
    {#if membersWithheld}
      <p class="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {t('app.members.withheld', 'The members of this App aren’t visible to you. This is not an empty list.')}
      </p>
    {/if}
  </LiveRegion>

  {#if membersError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {t('app.members.load-error', 'The member list could not be loaded. Reload to try again.')}
    </div>
  {/if}

  {#if ensureActionError || removeActionError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {ensureActionError ?? removeActionError}
    </div>
  {/if}
  <LiveRegion>
  {#if !(ensureActionError || removeActionError) && (ensureActionSuccess || removeActionSuccess)}
    <div class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
      {ensureActionSuccess ?? removeActionSuccess}
    </div>
  {/if}
  </LiveRegion>

  <!-- Member list -->
  {#if members.length > 0}
    <section class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
      {#each members as m (m.userId)}
        <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
          {#if m.user.avatarUrl}
            <img src={m.user.avatarUrl} alt={userLabel(m.user)} class="h-8 w-8 rounded-full" />
          {/if}
          <div class="flex-1 min-w-0">
            <p class="font-medium text-zinc-900 truncate dark:text-white">{userLabel(m.user)}</p>
            {#if m.user.githubUsername}
              <p class="text-xs text-zinc-500">@{m.user.githubUsername}</p>
            {:else if m.user.email}
              <p class="text-xs text-zinc-500">{m.user.email}</p>
            {/if}
          </div>

          {#if memberRoles.length > 0}
            <form method="POST" action="?/ensureMember" use:ensureEnhance class="flex items-center gap-2">
              <input type="hidden" name="_kind" value="ensureAppMember" />
              <input type="hidden" name="userId" value={m.userId} />
              <select name="role" data-user-id={m.userId} onchange={submitOnChange} disabled={$ensureSubmitting}
                class="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                {#each memberRoles as role}
                  <option value={role} selected={m.role === role}>{role}</option>
                {/each}
              </select>
            </form>
          {:else}
            <span class="text-xs text-zinc-500">{m.role}</span>
          {/if}

          <!-- Keep both handlers: onclick updates before client validation for button activation;
               onsubmit covers keyboard/requestSubmit paths. -->
          <form method="POST" action="?/removeMember" use:removeEnhance onsubmit={() => setRemoveUser(m.userId)}>
            <input type="hidden" name="_kind" value="removeAppMember" />
            <input type="hidden" name="userId" value={m.userId} />
            <button type="submit" disabled={$removeSubmitting} onclick={() => setRemoveUser(m.userId)} class="text-xs text-red-500 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-50 dark:text-red-400 dark:hover:text-red-300">Remove</button>
          </form>
        </div>
      {/each}
    </section>
  {:else if !membersError && !membersWithheld}
    <p class="text-sm text-zinc-500">No members yet.</p>
  {/if}

  <!-- Add member — on-demand user search (#653): no longer gated on a
       bulk-loaded user list, so a personal-app owner / non-admin can add the
       first member. -->
  {#if app.agent && !membersWithheld}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Add member</h2>
      {#if atLimit}
        <p class="mb-3 text-sm text-amber-600 dark:text-amber-400">
          This App is at the member limit set by the Agent ({memberLimit}). Remove a member or ask the Agent author to raise the cap.
        </p>
      {:else}
        <form method="POST" action="?/addMember" use:addEnhance class="flex flex-wrap items-start gap-3" novalidate>
          <input type="hidden" name="_kind" value="addAppMember" />
          <input type="hidden" name="userId" bind:value={$addForm.userId} />
          {#if memberRoles.length === 0}
            <p class="basis-full text-sm text-amber-700 dark:text-amber-400">
              {t('app-members.add.no-roles', 'This App offers no member roles yet.')}
              {t('app-members.add.no-roles-next', 'An owner or admin of the Agent can add roles on')}
              <a href="/app/agents/{app.agent.id}" class="underline">{app.agent.name}</a>.
            </p>
          {/if}
          {#if addActionError}
            <div class="basis-full rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{addActionError}</div>
          {/if}
          <div class="flex-1 min-w-[200px]">
            <label for="add-user-button" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">User</label>
            <button
              id="add-user-button"
              type="button"
              onclick={() => (selectUserOpen = true)}
              aria-haspopup="dialog"
              aria-expanded={selectUserOpen}
              aria-describedby={addUserError ? 'addUserError' : undefined}
              class="w-full truncate rounded-lg border border-zinc-300 bg-white px-3 py-2 text-left text-sm hover:bg-zinc-50 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800 {addUserError ? 'border-red-500 focus:border-red-500' : ''} {selectedUser ? 'text-zinc-900 dark:text-white' : 'text-zinc-400 dark:text-zinc-500'}"
            >
              {selectedUser ? selectedUserLabel : t('app-members.add.find-user', 'Find a user...')}
            </button>
            {#if addUserError}
              <p id="addUserError" class="mt-1 text-xs text-red-600 dark:text-red-400">{addUserError}</p>
            {/if}
          </div>
          <div>
            <label for="member-role" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
            <select id="member-role" name="role"
              bind:value={$addForm.role}
              aria-invalid={!!addRoleError}
              aria-describedby={addRoleError ? 'addRoleError' : undefined}
              {...$addConstraints.role}
              class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="" disabled>Select a role...</option>
              {#each memberRoles as role}
                <option value={role}>{role}</option>
              {/each}
            </select>
            {#if addRoleError}
              <p id="addRoleError" class="mt-1 text-xs text-red-600 dark:text-red-400">{addRoleError}</p>
            {/if}
          </div>
          <button type="submit" disabled={$addSubmitting || memberRoles.length === 0 || !selectedUser || !$addForm.role} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
            {$addSubmitting ? 'Adding...' : 'Add member'}
          </button>
        </form>

        <SelectUser
          search={searchUsers}
          bind:open={selectUserOpen}
          onselect={selectAddUser}
        />
      {/if}
    </section>
  {/if}
</div>
