<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';
  import { addAppMemberSchema, ensureAppMemberSchema, removeAppMemberSchema } from './schema';

  type AddAppMemberForm = Infer<typeof addAppMemberSchema, 'zod4'>;
  type EnsureAppMemberForm = Infer<typeof ensureAppMemberSchema, 'zod4'>;
  type RemoveAppMemberForm = Infer<typeof removeAppMemberSchema, 'zod4'>;
  type AddAppMemberSuperform = SuperValidated<AddAppMemberForm, App.Superforms.Message, AddAppMemberForm>;
  type EnsureAppMemberSuperform = SuperValidated<EnsureAppMemberForm, App.Superforms.Message, EnsureAppMemberForm>;
  type RemoveAppMemberSuperform = SuperValidated<RemoveAppMemberForm, App.Superforms.Message, RemoveAppMemberForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const app = $derived(data.app);
  const org = $derived(data.org);
  const members = $derived(data.members);
  const allUsers = $derived(data.allUsers);

  // Roles offered by the linked Agent's installation policy. The server
  // validates against this same list (InvalidRoleError if the role isn't
  // present), so the dropdown is the canonical source of truth.
  const memberRoles = $derived<string[]>(app.agent?.installationPolicy?.memberRoles ?? []);
  const maxMembers = $derived<string>(app.agent?.installationPolicy?.maxMembers ?? 'unlimited');
  const memberLimit = $derived<number | null>(
    maxMembers === 'unlimited' ? null : Number.parseInt(maxMembers, 10),
  );
  const atLimit = $derived(memberLimit !== null && members.length >= memberLimit);

  const memberIds = $derived(new Set(members.map((m) => m.userId)));
  const nonMembers = $derived(allUsers.filter((u) => !memberIds.has(u.id)));

  function reseedAddForm(addedUserId: string, submittedRole: string) {
    addForm.update(
      (current) => ({
        ...current,
        userId: nonMembers.find((user) => user.id !== addedUserId)?.id ?? '',
        role: memberRoles.includes(submittedRole) ? submittedRole : (memberRoles[0] ?? ''),
      }),
      { taint: false },
    );
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

  const initialAddForm = untrack(() => submittedForm<AddAppMemberForm>(form, 'addAppMember') as AddAppMemberSuperform | null ?? data.addForm);
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
      if (form.message?.type === 'success') reseedAddForm(form.data.userId, form.data.role);
    },
  });
  const addUserError = $derived($addErrors.userId?.[0] ?? null);
  const addRoleError = $derived($addErrors.role?.[0] ?? null);
  const addActionError = $derived(
    $addMessage?.type === 'error'
      ? $addMessage.text
      : $addErrors._kind?.[0] ?? null,
  );

  const initialEnsureForm = untrack(() => submittedForm<EnsureAppMemberForm>(form, 'ensureAppMember') as EnsureAppMemberSuperform | null ?? data.ensureForm);
  const {
    form: ensureForm,
    errors: ensureErrors,
    message: ensureMessage,
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

  const initialRemoveForm = untrack(() => submittedForm<RemoveAppMemberForm>(form, 'removeAppMember') as RemoveAppMemberSuperform | null ?? data.removeForm);
  const {
    form: removeForm,
    errors: removeErrors,
    message: removeMessage,
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

<svelte:head><title>Members · {app.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div>
    <Breadcrumb items={[
      { label: 'Apps', href: `/app/orgs/${org.id}/apps` },
      { label: app.name, href: `/app/orgs/${org.id}/apps/${app.id}` },
      { label: 'Members' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
      Members
      <span class="ml-2 text-sm font-normal text-zinc-500">({members.length}{memberLimit !== null ? ` / ${memberLimit}` : ''})</span>
    </h1>
    {#if app.agent}
      <p class="mt-1 text-sm text-zinc-500">
        Roles below are defined by the linked Agent
        <a href="/app/agents/{app.agent.id}" class="text-indigo-500 hover:underline dark:text-indigo-400">{app.agent.name}</a>.
      </p>
    {:else}
      <p class="mt-1 text-sm text-amber-600 dark:text-amber-400">
        This App has no Agent linked yet. Members can only be added once an Agent is linked.
      </p>
    {/if}
  </div>

  {#if ensureActionError || removeActionError}
    <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
      {ensureActionError ?? removeActionError}
    </div>
  {:else if ensureActionSuccess || removeActionSuccess}
    <div class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-300">
      {ensureActionSuccess ?? removeActionSuccess}
    </div>
  {/if}

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
            <form method="POST" action="?/ensure" use:ensureEnhance class="flex items-center gap-2">
              <input type="hidden" name="_kind" value="ensureAppMember" />
              <input type="hidden" name="userId" value={m.userId} />
              <select name="role" data-user-id={m.userId} onchange={submitOnChange}
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
          <form method="POST" action="?/remove" use:removeEnhance onsubmit={() => setRemoveUser(m.userId)}>
            <input type="hidden" name="_kind" value="removeAppMember" />
            <input type="hidden" name="userId" value={m.userId} />
            <button type="submit" onclick={() => setRemoveUser(m.userId)} class="text-xs text-red-500 hover:text-red-400 dark:text-red-400 dark:hover:text-red-300">Remove</button>
          </form>
        </div>
      {/each}
    </section>
  {:else}
    <p class="text-sm text-zinc-500">No members yet.</p>
  {/if}

  <!-- Add existing user -->
  {#if app.agent && nonMembers.length > 0 && memberRoles.length > 0}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Add member</h2>
      {#if atLimit}
        <p class="mb-3 text-sm text-amber-600 dark:text-amber-400">
          This App is at the member limit set by the Agent ({memberLimit}). Remove a member or ask the Agent author to raise the cap.
        </p>
      {:else}
        <form method="POST" action="?/add" use:addEnhance class="flex flex-wrap items-start gap-3" novalidate>
          <input type="hidden" name="_kind" value="addAppMember" />
          {#if addActionError}
            <div class="basis-full rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{addActionError}</div>
          {/if}
          <div class="flex-1 min-w-[200px]">
            <label for="userId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">User</label>
            <select id="userId" name="userId"
              bind:value={$addForm.userId}
              aria-invalid={!!addUserError}
              aria-describedby={addUserError ? 'addUserError' : undefined}
              {...$addConstraints.userId}
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              <option value="" disabled>Select a user...</option>
              {#each nonMembers as u (u.id)}
                <option value={u.id}>{userLabel(u)}{u.githubUsername ? ` (@${u.githubUsername})` : ''}</option>
              {/each}
            </select>
            {#if addUserError}
              <p id="addUserError" class="mt-1 text-xs text-red-600 dark:text-red-400">{addUserError}</p>
            {/if}
          </div>
          <div>
            <label for="role" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
            <select id="role" name="role"
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
          <button type="submit" disabled={$addSubmitting || !$addForm.userId || !$addForm.role} class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
            {$addSubmitting ? 'Adding...' : 'Add member'}
          </button>
        </form>
      {/if}
    </section>
  {/if}
</div>
