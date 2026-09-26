<script lang="ts">
  // #942 slice 2: an App's Channels. A table of the Channels in this App's
  // memories, with create / rename / delete through the sanctioned Channel
  // mutations. Register (who attends which Channel) is the next slice.
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import type { Channel } from '$lib/types';
  import type { PageData, ActionData } from './$types';
  import {
    CHANNEL_DESCRIPTION_MAX,
    CHANNEL_NAME_MAX,
    channelLoc,
    createChannelSchema,
    deleteChannelSchema,
    renameChannelSchema,
  } from './schema';

  type CreateForm = Infer<typeof createChannelSchema, 'zod4'>;
  type RenameForm = Infer<typeof renameChannelSchema, 'zod4'>;
  type DeleteForm = Infer<typeof deleteChannelSchema, 'zod4'>;

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const shared = $derived(data.app.sharedMemory);
  // null = the self-audit failed: offer the control and let the server answer.
  const canCreate = $derived(shared ? data.canWrite[shared.id] !== false : false);

  // ── create ──
  const {
    form: createData, errors: createErrors, message: createMessage, submitting: creating, enhance: createEnhance,
  } = superForm<CreateForm, App.Superforms.Message, CreateForm>(
    untrack(() => (submittedForm<CreateForm>(form, 'createChannel') as SuperValidated<CreateForm, App.Superforms.Message, CreateForm> | null) ?? data.createForm),
    { validators: zod4Client(createChannelSchema), validationMethod: 'oninput', clearOnSubmit: 'none', resetForm: true },
  );
  const createError = $derived(scopedActionError<CreateForm>(form, 'createChannel', $createMessage, $createErrors, ['name', 'slug', 'description', '_kind']));
  const createDone = $derived(scopedActionSuccess<CreateForm>(form, 'createChannel', $createMessage));

  // ── rename (one form, re-pointed at the row being edited) ──
  let editing = $state<string | null>(null);
  const {
    form: renameData, errors: renameErrors, message: renameMessage, submitting: renaming, enhance: renameEnhance,
  } = superForm<RenameForm, App.Superforms.Message, RenameForm>(
    untrack(() => (submittedForm<RenameForm>(form, 'renameChannel') as SuperValidated<RenameForm, App.Superforms.Message, RenameForm> | null) ?? data.renameForm),
    {
      validators: zod4Client(renameChannelSchema),
      clearOnSubmit: 'none',
      onResult: ({ result }) => {
        if (result.type === 'success') editing = null;
      },
    },
  );
  const renameError = $derived(scopedActionError<RenameForm>(form, 'renameChannel', $renameMessage, $renameErrors, ['name', 'description', 'ref', '_kind']));
  function startRename(c: Channel) {
    editing = c.id;
    renameData.set({ _kind: 'renameChannel', ref: c.id, name: c.name, description: c.description ?? '' }, { taint: false });
  }

  // ── delete (confirmed per row; the App's default gets a stronger warning) ──
  let confirmingDelete = $state<string | null>(null);
  const {
    form: deleteData, message: deleteMessage, submitting: deleting, enhance: deleteEnhance,
  } = superForm<DeleteForm, App.Superforms.Message, DeleteForm>(
    untrack(() => (submittedForm<DeleteForm>(form, 'deleteChannel') as SuperValidated<DeleteForm, App.Superforms.Message, DeleteForm> | null) ?? data.deleteForm),
    {
      validators: zod4Client(deleteChannelSchema),
      onResult: ({ result }) => {
        if (result.type === 'success') confirmingDelete = null;
      },
    },
  );
  const deleteError = $derived(scopedActionError<DeleteForm>(form, 'deleteChannel', $deleteMessage, null));
  // Superforms validates its OWN state, not the DOM: the hidden ref input alone
  // leaves `ref` empty, and the client validator silently cancels the submit
  // (Chip, team chat #2186). So opening the confirm sets it, as rename does.
  function startDelete(id: string) {
    confirmingDelete = id;
    deleteData.set({ _kind: 'deleteChannel', ref: id }, { taint: false });
  }

  // ── table ──
  interface Row {
    channel: Channel;
    id: string;
    name: string;
    /** The address as shown: the URN when there is one, else the loc. */
    address: string;
    host: string;
    lastMessage: string;
    isDefault: boolean;
    canWrite: boolean | null;
  }
  function when(iso: string | null): string {
    // Pinned locale, so SSR and the client format identically (the repo's
    // convention: AssetTable, the memory Info tab, fmtRunTime).
    return iso
      ? new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
      : t('app.channels.never', 'No messages yet');
  }
  const rows = $derived<Row[]>(
    data.channels.map((c) => ({
      channel: c,
      id: c.id,
      name: c.name,
      // A compound (pre-v2) host memory has no chatRootUrn, and its loc is only
      // memory-relative, so the id is the address there: the server accepts it
      // on every channelRef.
      address: c.chatRootUrn ?? c.id,
      host: c.memory.name,
      lastMessage: when(c.lastMessageAt),
      isDefault: c.id === data.defaultChannelId,
      canWrite: data.canWrite[c.memory.id] ?? null,
    })),
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    // Search matches what the cell shows: the name, the "Team chat" badge on
    // the default (which stays when it's renamed), and the description.
    {
      accessorFn: (r) => [r.name, r.isDefault ? t('app.channels.default', 'Team chat') : '', r.channel.description].filter(Boolean).join(' '),
      id: 'name',
      header: t('app.channels.col.name', 'Channel'),
      enableHiding: false,
      size: 240,
    },
    { accessorKey: 'address', header: t('app.channels.col.address', 'Address'), size: 300 },
    // The cell shows the memory's name and its URN chip; search finds either.
    { accessorFn: (r) => `${r.host} ${r.channel.memory.urn}`, id: 'host', header: t('app.channels.col.host', 'Lives in memory'), size: 220 },
    {
      accessorKey: 'lastMessage',
      id: 'lastMessage',
      header: t('app.channels.col.last', 'Last message'),
      size: 190,
      // Sort by the instant, not the localized words the column shows.
      sortFn: (a, b) => Date.parse(a.original.channel.lastMessageAt ?? '0') - Date.parse(b.original.channel.lastMessageAt ?? '0'),
    },
    { id: 'actions', header: '', enableSorting: false, enableHiding: false, size: 200 },
  ];
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });

  const inputClass =
    'w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500';
</script>

<svelte:head><title>{t('app.channels.head', 'Channels')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('app.channels.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.channels.crumb', 'Channels') },
  ]} />

  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
      <span class="font-normal text-zinc-400">{t('app.channels.title.prefix', 'Channels:')}</span> {data.app.name}
    </h1>
    <Urn value={data.app.urn} type="app" size={8} label={t('app.channels.urn.app', 'App')} />
    <p class="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
      {t(
        'app.channels.explainer',
        'A channel is a shared conversation that lives in one of this App’s memories. Who can read it and post to it is decided by that memory’s access. A channel adds no access of its own.',
      )}
    </p>
  </div>

  {#if deleteError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{deleteError}</div>
  {/if}
  {#if renameError && !editing}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{renameError}</div>
  {/if}

  {#if rows.length === 0}
    <div class="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
      {t('app.channels.empty', 'No channels you can read in this App yet.')}
    </div>
  {:else}
    <DataTable
      {table}
      listKey="app:channels"
      searchPlaceholder={t('app.channels.search', 'Search channels…')}
      searchAriaLabel={t('app.channels.search', 'Search channels…')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 30rem))"
    >
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'name'}
          {#if editing === row.id}
            <form method="POST" action="?/renameChannel" use:renameEnhance novalidate class="space-y-1.5">
              <input type="hidden" name="_kind" value="renameChannel" />
              <input type="hidden" name="ref" value={row.id} />
              <input aria-label={t('app.channels.rename.name', 'Channel name')} name="name" bind:value={$renameData.name} maxlength={CHANNEL_NAME_MAX} class={inputClass} />
              <input aria-label={t('app.channels.rename.description', 'Description')} name="description" bind:value={$renameData.description} maxlength={CHANNEL_DESCRIPTION_MAX} placeholder={t('app.channels.description.placeholder', 'What this channel is for (optional)')} class={inputClass} />
              {#if renameError}<p role="alert" class="text-xs text-red-600 dark:text-red-400">{renameError}</p>{/if}
              <div class="flex gap-2">
                <button type="submit" disabled={$renaming} class="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{t('app.channels.rename.save', 'Save')}</button>
                <button type="button" onclick={() => (editing = null)} class="rounded-md px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.channels.cancel', 'Cancel')}</button>
              </div>
            </form>
          {:else}
            <div class="min-w-0">
              <a href="/app/memories/{row.channel.memory.id}/nodes/{row.channel.chatRootNodeId}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.name}</a>
              {#if row.isDefault}
                <span class="ml-1 rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">{t('app.channels.default', 'Team chat')}</span>
              {/if}
              {#if row.channel.description}<div class="truncate text-xs text-zinc-500 dark:text-zinc-400">{row.channel.description}</div>{/if}
            </div>
          {/if}
        {:else if cell.column.id === 'address'}
          {#if row.channel.chatRootUrn}
            <Urn value={row.channel.chatRootUrn} type="node" size={8} label={t('app.channels.urn.channel', 'channel')} />
          {:else}
            <span class="font-mono text-xs" title={t('app.channels.address.id', 'This channel’s memory has no flat address; use its id.')}>{row.channel.id}</span>
          {/if}
        {:else if cell.column.id === 'host'}
          <div class="min-w-0">
            <div class="truncate">{row.host}</div>
            <Urn value={row.channel.memory.urn} type="memory" size={8} label={t('app.channels.urn.memory', 'memory')} />
          </div>
        {:else if cell.column.id === 'actions'}
          {#if row.canWrite === false}
            <span class="text-xs text-zinc-400" title={t('app.channels.readonly.hint', 'Changing a channel needs write access to the memory it lives in.')}>{t('app.channels.readonly', 'Read-only')}</span>
          {:else if confirmingDelete === row.id}
            <form method="POST" action="?/deleteChannel" use:deleteEnhance class="space-y-1.5">
              <input type="hidden" name="_kind" value="deleteChannel" />
              <input type="hidden" name="ref" value={row.id} />
              <p class="text-xs text-red-700 dark:text-red-300">
                {row.isDefault
                  ? t('app.channels.delete.default-warning', 'This is the App’s team chat. Deleting it unlinks it from the App: workers can no longer post to the team chat until a new default is set up.')
                  : t('app.channels.delete.warning', 'Delete this channel and its messages? Its address stays reserved.')}
              </p>
              <div class="flex gap-2">
                <button type="submit" disabled={$deleting} class="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">{t('app.channels.delete.confirm', 'Delete')}</button>
                <button type="button" onclick={() => (confirmingDelete = null)} class="rounded-md px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.channels.cancel', 'Cancel')}</button>
              </div>
            </form>
          {:else}
            <div class="flex gap-1">
              <button type="button" onclick={() => startRename(row.channel)} class="rounded-md px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.channels.rename', 'Rename')}</button>
              <button type="button" onclick={() => startDelete(row.id)} class="rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950">{t('app.channels.delete', 'Delete')}</button>
            </div>
          {/if}
        {:else}
          <div class="truncate">{cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}

  <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.channels.create.title', 'New channel')}</h2>
    {#if !shared}
      <!-- A null sharedMemory is "not provisioned" OR "you can't read it": the
           server doesn't say which (hrn:node:hadronmemory.com:specs:cor:api:140:03),
           so neither does this. -->
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{t('app.channels.create.no-host', 'This App’s shared memory, where its channels live, isn’t available to you.')}</p>
    {:else if !canCreate}
      <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {t('app.channels.create.no-write', 'Adding a channel needs write access to {memory}, where this App’s channels live.', { memory: shared.name })}
      </p>
      <Urn value={shared.urn} type="memory" size={8} label={t('app.channels.urn.memory', 'memory')} />
    {:else}
      <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {t('app.channels.create.where', 'It is created in {memory}, alongside the App’s team chat, so it has that memory’s audience.', { memory: shared.name })}
      </p>
      <Urn value={shared.urn} type="memory" size={8} label={t('app.channels.urn.memory', 'memory')} />
      {#if createDone}<p role="status" class="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{createDone}</p>{/if}
      {#if createError}<p role="alert" class="mt-2 text-sm text-red-600 dark:text-red-400">{createError}</p>{/if}
      <form method="POST" action="?/createChannel" use:createEnhance novalidate class="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="_kind" value="createChannel" />
        <label class="block text-xs text-zinc-600 dark:text-zinc-400">
          {t('app.channels.create.name', 'Name')}
          <input name="name" bind:value={$createData.name} maxlength={CHANNEL_NAME_MAX} placeholder={t('app.channels.create.name.placeholder', 'Release coordination')} aria-invalid={$createErrors.name ? 'true' : undefined} aria-describedby={$createErrors.name ? 'create-name-error' : undefined} class="mt-1 {inputClass}" />
          {#if $createErrors.name}<span id="create-name-error" class="mt-1 block text-[11px] text-red-600 dark:text-red-400">{$createErrors.name[0]}</span>{/if}
        </label>
        <label class="block text-xs text-zinc-600 dark:text-zinc-400">
          {t('app.channels.create.slug', 'Short name (part of its address)')}
          <input name="slug" bind:value={$createData.slug} placeholder="release" aria-invalid={$createErrors.slug ? 'true' : undefined} aria-describedby={$createErrors.slug ? 'create-slug-error' : 'create-slug-address'} class="mt-1 {inputClass} font-mono" />
          {#if $createErrors.slug}
            <span id="create-slug-error" class="mt-1 block text-[11px] text-red-600 dark:text-red-400">{$createErrors.slug[0]}</span>
          {:else}
            <span id="create-slug-address" class="mt-1 block font-mono text-[11px] text-zinc-400">{channelLoc($createData.slug.trim() || '…')}</span>
          {/if}
        </label>
        <label class="block text-xs text-zinc-600 sm:col-span-2 dark:text-zinc-400">
          {t('app.channels.create.description', 'Description')}
          <input name="description" bind:value={$createData.description} maxlength={CHANNEL_DESCRIPTION_MAX} placeholder={t('app.channels.description.placeholder', 'What this channel is for (optional)')} class="mt-1 {inputClass}" />
        </label>
        <div class="sm:col-span-2">
          <button type="submit" disabled={$creating} class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">{t('app.channels.create.submit', 'Create channel')}</button>
        </div>
      </form>
    {/if}
  </section>
</div>
