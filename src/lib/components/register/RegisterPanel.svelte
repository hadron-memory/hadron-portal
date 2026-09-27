<script lang="ts">
  // #942 — the register: who TAKES PART in which Channel. Shared by the App
  // Channels page (App-owned rows) and the organization's Channels page
  // (org-owned rows). A row never grants access: reading and posting stay the
  // host memory's call.
  //
  // `ownerType` is the page's own owner. Its rows are editable when the caller
  // may manage them. Rows of the OTHER owner (an organization's rows shown on
  // an App page) are inherited: shown, labelled, and never offered for editing
  // here. The server's owner gates decide every write regardless.
  import { untrack, type Snippet } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import { countsAsNewLabel } from '$lib/register-counts';
  import {
    REGISTER_DESCRIPTION_MAX,
    REGISTER_ROLES,
    addAttendanceSchema,
    editAttendanceSchema,
    removeAttendanceSchema,
  } from '$lib/register/schema';
  import type { Attendee } from '$lib/register/types';
  import type { Channel, RegisterEntry } from '$lib/types';

  type AddForm = Infer<typeof addAttendanceSchema, 'zod4'>;
  type EditForm = Infer<typeof editAttendanceSchema, 'zod4'>;
  type RemoveForm = Infer<typeof removeAttendanceSchema, 'zod4'>;
  type Role = (typeof REGISTER_ROLES)[number];
  type OwnerType = 'APP' | 'ORGANIZATION';

  let {
    rows,
    ownerType,
    ownerId,
    canManage,
    channels,
    attendees,
    addForm,
    editForm,
    removeForm,
    actionData,
    listKey,
    loadFailed = false,
    inheritedHref = null,
    between,
  }: {
    /** Every row to show: the owner's own, plus any inherited ones. */
    rows: RegisterEntry[];
    ownerType: OwnerType;
    /**
     * The page's App or organization. SvelteKit reuses this component across
     * /app/orgs/A/channels → B (and App → App), so a change of owner reseeds
     * every form: nothing typed for A may be submitted against B.
     */
    ownerId: string;
    /** May the caller manage this owner's rows? `null` = unknown: offer, and let the server decide. */
    canManage: boolean | null;
    /** The Channels the add form offers. */
    channels: Channel[];
    attendees: Attendee[];
    addForm: SuperValidated<AddForm, App.Superforms.Message, AddForm>;
    editForm: SuperValidated<EditForm, App.Superforms.Message, EditForm>;
    removeForm: SuperValidated<RemoveForm, App.Superforms.Message, RemoveForm>;
    /** The page's action result (`form`). */
    actionData: unknown;
    /** Saved-view key, distinct per surface. */
    listKey: string;
    loadFailed?: boolean;
    /** Where inherited (org) rows are managed, when the caller may go there. */
    inheritedHref?: string | null;
    /** Rendered between the table and the add form (the App page's effective view). */
    between?: Snippet;
  } = $props();

  const isApp = $derived(ownerType === 'APP');

  function roleLabel(role: Role): string {
    switch (role) {
      case 'WATCH':
        return t('app.channels.register.role.watch', 'Watch');
      case 'POST':
        return t('app.channels.register.role.post', 'Post');
      default:
        return t('app.channels.register.role.both', 'Watch and post');
    }
  }
  const canManageRegister = $derived(canManage !== false);

  const {
    form: addData, errors: addErrors, message: addMessage, submitting: adding, enhance: addEnhance,
  } = superForm<AddForm, App.Superforms.Message, AddForm>(
    untrack(() => (submittedForm<AddForm>(actionData, 'addAttendance') as SuperValidated<AddForm, App.Superforms.Message, AddForm> | null) ?? addForm),
    { validators: zod4Client(addAttendanceSchema), clearOnSubmit: 'none', resetForm: true },
  );
  const addError = $derived(scopedActionError<AddForm>(actionData, 'addAttendance', $addMessage, $addErrors, ['channelId', 'attendee', 'description', '_kind']));
  const addDone = $derived(scopedActionSuccess<AddForm>(actionData, 'addAttendance', $addMessage));

  let editingRow = $state<string | null>(null);
  const {
    form: editData, errors: editErrors, message: editMessage, submitting: savingEdit, enhance: editEnhance,
  } = superForm<EditForm, App.Superforms.Message, EditForm>(
    untrack(() => (submittedForm<EditForm>(actionData, 'editAttendance') as SuperValidated<EditForm, App.Superforms.Message, EditForm> | null) ?? editForm),
    {
      validators: zod4Client(editAttendanceSchema),
      clearOnSubmit: 'none',
      onResult: ({ result }) => {
        if (result.type === 'success') editingRow = null;
      },
    },
  );
  const editError = $derived(scopedActionError<EditForm>(actionData, 'editAttendance', $editMessage, $editErrors, ['description', 'ref', '_kind']));
  function startEdit(r: RegisterEntry) {
    editingRow = r.id;
    // One form serves every row, so a previous row's refusal must not show in
    // this one's editor.
    editMessage.set(undefined);
    editErrors.clear();
    editData.set({ _kind: 'editAttendance', ref: r.id, role: r.role, mentionOnly: r.mentionOnly, description: r.description ?? '' }, { taint: false });
  }

  let confirmingRemove = $state<string | null>(null);
  const {
    form: removeData, message: removeMessage, submitting: removing, enhance: removeEnhance,
  } = superForm<RemoveForm, App.Superforms.Message, RemoveForm>(
    untrack(() => (submittedForm<RemoveForm>(actionData, 'removeAttendance') as SuperValidated<RemoveForm, App.Superforms.Message, RemoveForm> | null) ?? removeForm),
    {
      validators: zod4Client(removeAttendanceSchema),
      onResult: ({ result }) => {
        if (result.type === 'success') confirmingRemove = null;
      },
    },
  );
  const removeError = $derived(scopedActionError<RemoveForm>(actionData, 'removeAttendance', $removeMessage, null));
  // Superforms validates its own state, so the ref must be set there, not only
  // in the hidden input (Chip, team chat #2185).
  function startRemove(id: string) {
    confirmingRemove = id;
    // A previous row's refusal must not show while confirming this one.
    removeMessage.set(undefined);
    removeData.set({ _kind: 'removeAttendance', ref: id }, { taint: false });
  }

  // Reseed on a change of owner
  // (hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form).
  // The superForms were initialised once from the FIRST owner's props, so A's
  // add-form values, messages and errors would otherwise survive onto B's page.
  let seenOwner = untrack(() => ownerId);
  $effect(() => {
    const id = ownerId;
    untrack(() => {
      if (id === seenOwner) return;
      seenOwner = id;
      addData.set($state.snapshot(addForm.data), { taint: false });
      addErrors.clear();
      addMessage.set(undefined);
      editData.set($state.snapshot(editForm.data), { taint: false });
      editErrors.clear();
      editMessage.set(undefined);
      removeData.set($state.snapshot(removeForm.data), { taint: false });
      removeMessage.set(undefined);
      editingRow = null;
      confirmingRemove = null;
      attendFilter = '';
    });
  });

  interface AttendRow {
    entry: RegisterEntry;
    id: string;
    channel: string;
    attendee: string;
    mode: string;
    mentions: string;
    setBy: string;
    /** The row's own note (its description), shown so what was saved stays visible. */
    note: string;
    editable: boolean;
    /** Owned by the other owner (an organization's row on an App page). */
    inherited: boolean;
  }
  function attendeeLabel(r: RegisterEntry): string {
    const id = r.attendeeWorkerId ?? r.attendeeAgentId;
    if (!id) {
      return r.ownerType === 'APP'
        ? t('app.channels.register.everyone-app', 'Everyone in this App')
        : t('app.channels.register.everyone-org', 'Everyone in the organization');
    }
    const a = attendees.find((x) => x.id === id);
    if (a) return a.kind === 'worker' ? a.name : t('app.channels.register.agent', '{name} (agent)', { name: a.name });
    return r.attendeeUrn ?? t('app.channels.register.unknown-attendee', 'An attendee not listed here');
  }
  // Retired Workers name old rows but take no new ones.
  const pickable = $derived(attendees.filter((a) => !a.retired));
  const pickedChannel = $derived(channels.find((c) => c.id === $addData.channelId) ?? null);
  const pickedAttendee = $derived(pickable.find((a) => a.id === $addData.attendee) ?? null);
  const attendRows = $derived<AttendRow[]>(
    rows.map((r) => ({
      entry: r,
      id: r.id,
      // A Channel whose host memory the caller can't read comes back null:
      // say so without naming it.
      channel: r.channel?.name ?? t('app.channels.register.hidden-channel', 'A channel you can’t read'),
      attendee: attendeeLabel(r),
      mode: roleLabel(r.role),
      mentions: countsAsNewLabel(r.role, r.mentionOnly),
      setBy:
        r.ownerType === 'APP'
          ? r.installDefault
            ? t('app.channels.register.set-by.install', 'This App (set up at install)')
            : t('app.channels.register.set-by.app', 'This App')
          : t('app.channels.register.set-by.org', 'The organization'),
      note: r.description ?? '',
      // A page edits and removes only ITS OWNER's rows; any other owner's are
      // shown, not offered.
      editable: r.ownerType === ownerType && canManageRegister,
      inherited: r.ownerType !== ownerType,
    })),
  );

  let attendFilter = $state('');
  const attendColumns: PortalColumnDef<AttendRow>[] = [
    // Search matches the URN chips the cells show, not just the names.
    // A readable Channel in a compound memory has no chatRootUrn; its id is its address.
    { accessorFn: (r) => [r.channel, r.entry.channel ? (r.entry.channel.chatRootUrn ?? r.entry.channelId) : null].filter(Boolean).join(' '), id: 'channel', header: t('app.channels.register.col.channel', 'Channel'), size: 200 },
    { accessorFn: (r) => [r.attendee, r.entry.attendeeUrn].filter(Boolean).join(' '), id: 'attendee', header: t('app.channels.register.col.attendee', 'Who'), size: 220 },
    // Not hideable: this cell renders the row's edit <form>, which the Save
    // button in the actions cell submits by id. Hidden, Save would target a
    // form that isn't in the DOM.
    { accessorKey: 'mode', header: t('app.channels.register.col.mode', 'Takes part as'), size: 170, enableHiding: false },
    { accessorKey: 'mentions', header: t('app.channels.register.col.mentions', 'Counts as new'), size: 170 },
    { accessorKey: 'setBy', header: t('app.channels.register.col.set-by', 'Set by'), size: 190 },
    { accessorKey: 'note', header: t('app.channels.register.col.note', 'Note'), size: 200 },
    { id: 'actions', header: '', enableSorting: false, enableHiding: false, size: 200 },
  ];
  const attendTable = createSvelteTable<AttendRow>({
    get data() { return attendRows; },
    columns: attendColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return attendFilter; } },
    onGlobalFilterChange: (u) => { attendFilter = typeof u === 'function' ? u(attendFilter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

{#if loadFailed}
  <div role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
    {t('app.channels.register.load-failed', 'Couldn’t load who takes part just now. This is an error, not an empty list. Try refreshing the page.')}
  </div>
{:else}
  {#if removeError}<div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{removeError}</div>{/if}
  {#if editError && !editingRow}<div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{editError}</div>{/if}

  {#if attendRows.length === 0}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.channels.register.empty', 'Nobody is set up to take part in a channel yet.')}</p>
  {:else}
    <DataTable
      table={attendTable}
      {listKey}
      searchPlaceholder={t('app.channels.register.search', 'Search…')}
      searchAriaLabel={t('app.channels.register.search', 'Search…')}
      bind:globalFilter={attendFilter}
      maxHeight="max(200px, calc(100vh - 30rem))"
    >
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'mode' && editingRow === row.id}
          <form id="edit-attendance-{row.id}" method="POST" action="?/editAttendance" use:editEnhance novalidate class="space-y-1.5">
            <input type="hidden" name="_kind" value="editAttendance" />
            <input type="hidden" name="ref" value={row.id} />
            <select name="role" aria-label={t('app.channels.register.col.mode', 'Takes part as')} bind:value={$editData.role} class="{inputClass} py-1">
              {#each REGISTER_ROLES as r (r)}<option value={r}>{roleLabel(r)}</option>{/each}
            </select>
            <label class="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
              <input type="checkbox" name="mentionOnly" bind:checked={$editData.mentionOnly} />
              {t('app.channels.register.mentions.only', 'Only when mentioned')}
            </label>
            <input name="description" aria-label={t('app.channels.register.note', 'Note')} bind:value={$editData.description} maxlength={REGISTER_DESCRIPTION_MAX} placeholder={t('app.channels.register.note.placeholder', 'Why they take part (optional)')} class="{inputClass} py-1" />
            {#if editError}<p role="alert" class="text-xs text-red-600 dark:text-red-400">{editError}</p>{/if}
          </form>
        {:else if cell.column.id === 'actions'}
          {#if row.inherited}
            <!-- Another owner's row: read-only here. Link to where it IS managed
                 when the caller may go there; otherwise just say whose it is. -->
            {#if inheritedHref}
              <a href={inheritedHref} class="text-xs text-indigo-600 hover:underline dark:text-indigo-300" title={t('app.channels.register.readonly.org', 'Set by the organization; change it in the organization’s settings.')}>{t('app.channels.register.manage-in-org', 'Managed by the organization')}</a>
            {:else}
              <span class="text-xs text-zinc-400" title={t('app.channels.register.readonly.org', 'Set by the organization; change it in the organization’s settings.')}>{t('app.channels.readonly', 'Read-only')}</span>
            {/if}
          {:else if !row.editable}
            <span class="text-xs text-zinc-400" title={isApp
              ? t('app.channels.register.readonly.app', 'Changing this App’s attendance needs admin rights on the App.')
              : t('app.channels.register.readonly.org-role', 'Changing the organization’s attendance needs contributor rights in the organization.')}>{t('app.channels.readonly', 'Read-only')}</span>
          {:else if editingRow === row.id}
            <div class="flex gap-2">
              <button type="submit" form="edit-attendance-{row.id}" disabled={$savingEdit} class="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{t('app.channels.rename.save', 'Save')}</button>
              <button type="button" onclick={() => (editingRow = null)} class="rounded-md px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.channels.cancel', 'Cancel')}</button>
            </div>
          {:else if confirmingRemove === row.id}
            <form method="POST" action="?/removeAttendance" use:removeEnhance class="flex flex-wrap items-center gap-2">
              <input type="hidden" name="_kind" value="removeAttendance" />
              <input type="hidden" name="ref" value={row.id} />
              <span class="text-xs text-red-700 dark:text-red-300">{t('app.channels.register.remove.confirm-text', 'Stop taking part?')}</span>
              <button type="submit" disabled={$removing} class="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">{t('app.channels.register.remove', 'Remove')}</button>
              <button type="button" onclick={() => (confirmingRemove = null)} class="rounded-md px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.channels.cancel', 'Cancel')}</button>
            </form>
          {:else}
            <div class="flex gap-1">
              <button type="button" onclick={() => startEdit(row.entry)} class="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.channels.register.edit', 'Edit')}</button>
              <button type="button" onclick={() => startRemove(row.id)} class="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">{t('app.channels.register.remove', 'Remove')}</button>
            </div>
          {/if}
        {:else if cell.column.id === 'channel' && row.entry.channel?.chatRootUrn}
          <div class="min-w-0">
            <div class="truncate">{row.channel}</div>
            <Urn value={row.entry.channel.chatRootUrn} type="node" size={8} label={t('app.channels.urn.channel', 'channel')} />
          </div>
        {:else if cell.column.id === 'channel' && row.entry.channel}
          <!-- No flat address (compound memory): the id, as in the Channels table. -->
          <div class="min-w-0">
            <div class="truncate">{row.channel}</div>
            <span class="font-mono text-xs">{row.entry.channelId}</span>
          </div>
        {:else if cell.column.id === 'attendee' && row.entry.attendeeUrn}
          <div class="min-w-0">
            <div class="truncate">{row.attendee}</div>
            <Urn value={row.entry.attendeeUrn} type={row.entry.attendeeWorkerId ? 'worker' : 'agent'} size={8} label={t('app.channels.register.urn', 'attendee')} />
          </div>
        {:else}
          <div class="truncate">{cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}

  {@render between?.()}

  {#if canManageRegister && channels.length > 0}
    <div class="border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('app.channels.register.add.title', 'Add someone to a channel')}</h3>
      {#if addDone}<p role="status" class="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{addDone}</p>{/if}
      {#if addError}<p role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{addError}</p>{/if}
      <form method="POST" action="?/addAttendance" use:addEnhance novalidate class="mt-2 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="_kind" value="addAttendance" />
        <label class="block text-xs text-zinc-600 dark:text-zinc-400">
          {t('app.channels.register.col.channel', 'Channel')}
          <select name="channelId" bind:value={$addData.channelId} aria-invalid={$addErrors.channelId ? 'true' : undefined} aria-describedby={$addErrors.channelId ? 'add-channel-error' : undefined} class="mt-1 {inputClass}">
            <option value="" disabled>{t('app.channels.register.pick-channel', 'Pick a channel…')}</option>
            {#each channels as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
          </select>
          <!-- A `novalidate` form posts an empty pick and the server's refusal
               comes back as this field's error: show it next to the picker. -->
          {#if $addErrors.channelId}
            <span id="add-channel-error" role="alert" class="mt-1 block text-[11px] text-red-600 dark:text-red-400">{$addErrors.channelId[0]}</span>
          {/if}
          <!-- Two Channels can share a name: the chosen one's address tells them
               apart. A compound-memory Channel has no flat address, so its id. -->
          {#if pickedChannel?.chatRootUrn}
            <span class="mt-1 block">
              <Urn value={pickedChannel.chatRootUrn} type="node" size={8} label={t('app.channels.urn.channel', 'channel')} />
            </span>
          {:else if pickedChannel}
            <span class="mt-1 block font-mono text-xs">{pickedChannel.id}</span>
          {/if}
        </label>
        <label class="block text-xs text-zinc-600 dark:text-zinc-400">
          {t('app.channels.register.col.attendee', 'Who')}
          <select name="attendee" bind:value={$addData.attendee} class="mt-1 {inputClass}">
            <option value="">{isApp ? t('app.channels.register.everyone-app', 'Everyone in this App') : t('app.channels.register.everyone-org', 'Everyone in the organization')}</option>
            {#each pickable as a (a.id)}
              <option value={a.id}>{a.kind === 'worker' ? a.name : t('app.channels.register.agent', '{name} (agent)', { name: a.name })}</option>
            {/each}
          </select>
          <!-- An <option> can't hold a chip: the chosen one's address shows here,
               which is what tells two same-named Agents apart. -->
          {#if pickedAttendee?.urn}
            <span class="mt-1 block">
              <Urn value={pickedAttendee.urn} type={pickedAttendee.kind === 'worker' ? 'worker' : 'agent'} size={8} label={t('app.channels.register.urn', 'attendee')} />
            </span>
          {/if}
          <!-- On an organization's page, a Worker's App is part of who they are. -->
          {#if pickedAttendee?.appUrn}
            <span class="mt-1 block">
              <Urn value={pickedAttendee.appUrn} type="app" size={8} label={t('app.channels.register.urn.app', 'App')} />
            </span>
          {/if}
        </label>
        <label class="block text-xs text-zinc-600 dark:text-zinc-400">
          {t('app.channels.register.col.mode', 'Takes part as')}
          <select name="role" bind:value={$addData.role} class="mt-1 {inputClass}">
            {#each REGISTER_ROLES as r (r)}<option value={r}>{roleLabel(r)}</option>{/each}
          </select>
        </label>
        <label class="flex items-center gap-2 self-end pb-2 text-xs text-zinc-600 dark:text-zinc-400">
          <input type="checkbox" name="mentionOnly" bind:checked={$addData.mentionOnly} />
          {t('app.channels.register.mentions.only', 'Only when mentioned')}
        </label>
        <label class="block text-xs text-zinc-600 sm:col-span-2 dark:text-zinc-400">
          {t('app.channels.register.note', 'Note')}
          <input name="description" bind:value={$addData.description} maxlength={REGISTER_DESCRIPTION_MAX} placeholder={t('app.channels.register.note.placeholder', 'Why they take part (optional)')} class="mt-1 {inputClass}" />
        </label>
        <div class="sm:col-span-2">
          <button type="submit" disabled={$adding} class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{t('app.channels.register.add', 'Add')}</button>
        </div>
      </form>
    </div>
  {:else if !canManageRegister}
    <p class="text-xs text-zinc-500 dark:text-zinc-400">
      {isApp
        ? t('app.channels.register.no-manage', 'Changing who takes part needs admin rights on this App.')
        : t('app.channels.register.no-manage-org', 'Changing who takes part needs contributor rights in this organization.')}
    </p>
  {/if}
{/if}
