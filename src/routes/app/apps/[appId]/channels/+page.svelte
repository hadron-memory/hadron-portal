<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  // #942 slice 2: an App's Channels. A table of the Channels in this App's
  // memories, with create / rename / delete through the sanctioned Channel
  // mutations. Register (who attends which Channel) is the next slice.
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import NodeActionsMenu from '$lib/components/NodeActionsMenu.svelte';
  import RegisterPanel from '$lib/components/register/RegisterPanel.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import type { Channel } from '$lib/types';
  import type { EffectiveRow } from '$lib/register-view';
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
    // One form serves every row: a previous row's refusal must not show up in
    // this one's editor.
    renameMessage.set(undefined);
    renameErrors.clear();
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
    // A previous row's refusal must not show while confirming this one.
    deleteMessage.set(undefined);
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
      // #2509: seeing a Channel does not grant its host memory's record, so
      // memory may be null — the host cell then renders the withheld note.
      host: c.memory?.name ?? '',
      lastMessage: when(c.lastMessageAt),
      isDefault: c.id === data.defaultChannelId,
      // A concealed host never entered the loader's audit map, so the lookup
      // misses and lands on null: write access unknown, the gate decides.
      canWrite: data.canWrite[c.memoryId] ?? null,
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
    { accessorFn: (r) => `${r.host} ${r.channel.memory?.urn ?? ''}`, id: 'host', header: t('app.channels.col.host', 'Lives in memory'), size: 220 },
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

  // ── #942 slice 3: who takes part. The register itself is the shared
  // RegisterPanel (also on the organization's Channels page). ──
  // The organization's rows are managed on its own Channels page. Link there
  // only for an org the caller belongs to; anyone else sees them read-only.
  const orgRegisterHref = $derived(
    data.app.organizationId && data.navOrgs?.some((o: { id: string }) => o.id === data.app.organizationId)
      ? `/app/orgs/${data.app.organizationId}/channels`
      : null,
  );
  // Retired Workers name old rows but take no new ones (the effective view's picker).
  const pickable = $derived(data.attendees.filter((a) => !a.retired));

  // ── #942 slice 4: what one attendee effectively follows (on demand) ──
  let effectiveFor = $state('');
  const effectiveAttendee = $derived(data.attendees.find((a) => a.id === effectiveFor) ?? null);
  let effective = $state<{ rows: EffectiveRow[]; loadedAt: string } | null>(null);
  let effectiveState = $state<'idle' | 'loading' | 'failed'>('idle');
  // Each request is numbered; only the latest may write the panel, so a slow
  // answer for the previous pick can't overwrite the current one.
  let effectiveSeq = 0;
  // `data` is replaced whenever the page reloads: after an Add, Save or Remove
  // on this App's register, or when SvelteKit REUSES this component for another
  // App (/app/apps/A/channels → B). Either way the effective view is stale:
  // - another App: nothing of A's view may survive, so clear the pick and the
  //   panel and bump the sequence so an in-flight answer for A is dropped
  //   (hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form);
  // - the same App: re-resolve the selected attendee, since the winning row
  //   may have just changed.
  let seenData = untrack(() => data);
  $effect(() => {
    const d = data;
    untrack(() => {
      if (d === seenData) return;
      const appChanged = d.app.id !== seenData.app.id;
      seenData = d;
      if (appChanged) {
        effectiveSeq++;
        effectiveFor = '';
        effective = null;
        effectiveState = 'idle';
      } else if (effectiveFor && !d.attendees.some((a) => a.id === effectiveFor && !a.retired)) {
        // The pick is no longer offered (retired, or gone since the reload).
        effectiveSeq++;
        effectiveFor = '';
        effective = null;
        effectiveState = 'idle';
      } else if (effectiveFor) {
        void loadEffective(effectiveFor);
      }
    });
  });
  async function loadEffective(attendeeId: string) {
    const seq = ++effectiveSeq;
    effective = null;
    if (!attendeeId) {
      effectiveState = 'idle';
      return;
    }
    const a = data.attendees.find((x) => x.id === attendeeId);
    if (!a) return;
    effectiveState = 'loading';
    try {
      const res = await fetch(`${basePath}/channels/effective?attendee=${encodeURIComponent(a.id)}&kind=${a.kind}`);
      const body = await res.json();
      if (seq !== effectiveSeq) return;
      if (!res.ok || body.loadFailed) {
        effectiveState = 'failed';
        return;
      }
      effective = { rows: body.rows, loadedAt: body.loadedAt };
      effectiveState = 'idle';
    } catch {
      if (seq === effectiveSeq) effectiveState = 'failed';
    }
  }
  let effectiveFilter = $state('');
  const effectiveColumns: PortalColumnDef<EffectiveRow>[] = [
    // Search matches the URN chip the cell shows under the name.
    { accessorFn: (r) => [r.channel, r.channelUrn].filter(Boolean).join(' '), id: 'channel', header: t('app.channels.register.col.channel', 'Channel'), size: 180 },
    { accessorKey: 'mode', header: t('app.channels.register.col.mode', 'Takes part as'), size: 150 },
    { accessorKey: 'counts', header: t('app.channels.register.col.mentions', 'Counts as new'), size: 160 },
    { accessorKey: 'because', header: t('app.channels.effective.col.because', 'Because of'), size: 260 },
    { accessorKey: 'readUpTo', header: t('app.channels.effective.col.read', 'Read'), size: 170 },
    { accessorKey: 'note', header: t('app.channels.effective.col.note', 'Note'), size: 200 },
  ];
  const effectiveTable = createSvelteTable<EffectiveRow>({
    get data() { return effective?.rows ?? []; },
    columns: effectiveColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return effectiveFilter; } },
    onGlobalFilterChange: (u) => { effectiveFilter = typeof u === 'function' ? u(effectiveFilter) : u; },
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
              <a href="/app/memories/{row.channel.memoryId}/nodes/{row.channel.chatRootNodeId}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.name}</a>
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
            {#if row.channel.memory}
              <Urn value={row.channel.memory.urn} type="memory" size={8} label={t('app.channels.urn.memory', 'memory')} />
            {:else}
              <!-- #2509: the record is concealed, not empty — render it as
                   absent (never an empty chip), with the reason on hover. -->
              <span class="text-xs text-zinc-500 dark:text-zinc-400" title={t('app.channels.host-hidden-title', 'Seeing this channel doesn’t grant its memory’s record.')}>{t('app.channels.host-hidden', 'Memory not shown')}</span>
            {/if}
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
                  : t('app.channels.delete.warning', 'Delete this channel and its messages? The messages won’t come back, even if you create a channel at this address again later.')}
              </p>
              <div class="flex gap-2">
                <button type="submit" disabled={$deleting} class="rounded-md bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50">{t('app.channels.delete.confirm', 'Delete')}</button>
                <button type="button" onclick={() => (confirmingDelete = null)} class="rounded-md px-3 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.channels.cancel', 'Cancel')}</button>
              </div>
            </form>
          {:else}
            <!-- #1020: Rename and Delete live in the row's ⋯ menu; each still
                 opens its inline form in place. -->
            <NodeActionsMenu
              actions={[
                { id: 'rename', label: t('app.channels.rename', 'Rename') },
                { id: 'delete', label: t('app.channels.delete', 'Delete'), danger: true },
              ]}
              onselect={(id) => { if (id === 'rename') startRename(row.channel); else if (id === 'delete') startDelete(row.id); }}
              label={t('app.channels.actions.label', 'Actions for {channel}', { channel: row.name })}
              fixed
              compact
            />
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
      <LiveRegion>
        {#if createDone}<p class="mt-2 text-sm text-emerald-700 dark:text-emerald-400">{createDone}</p>{/if}
      </LiveRegion>
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
          <input name="slug" bind:value={$createData.slug} placeholder={t('app.channels.create.slug.placeholder', 'release')} aria-invalid={$createErrors.slug ? 'true' : undefined} aria-describedby={$createErrors.slug ? 'create-slug-error' : 'create-slug-address'} class="mt-1 {inputClass} font-mono" />
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
  <!-- #942 slice 3: the register. A row says who TAKES PART in a channel. It
       never grants access: reading and posting stay the host memory's call. -->
  <section class="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <div>
      <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.channels.register.title', 'Who takes part')}</h2>
      <p class="mt-1 max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">
        {t(
          'app.channels.register.explainer',
          'Choose which of this App’s workers and agents follow each channel. Watch means new messages count for them; Post means they’re expected to write there; both is the default. “Only when mentioned” counts a message as new only if it names them. This records who takes part. It doesn’t give anyone access: reading and posting are still decided by the channel’s memory.',
        )}
      </p>
    </div>

    <LiveRegion>
      {#if data.agentsWithheld}
        <p class="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
          {t('app.channels.agents-withheld', 'The agents installed in this App aren’t visible to you, so they aren’t offered below. This is not an empty list.')}
        </p>
      {/if}
    </LiveRegion>
    <RegisterPanel
      rows={[...data.appRows, ...data.orgRows]}
      ownerType="APP"
      ownerId={data.app.id}
      canManage={data.canManageRegister}
      channels={data.channels}
      attendees={data.attendees}
      addForm={data.addAttendanceForm}
      editForm={data.editAttendanceForm}
      removeForm={data.removeAttendanceForm}
      actionData={form}
      listKey="app:register"
      loadFailed={data.registerLoadFailed}
      inheritedHref={orgRegisterHref}
    >
      {#snippet between()}
        <!-- #942 slice 4: the EFFECTIVE result for one attendee. Only facts true
             about the attendee; the resolver's read/post standing is the
             viewer's, so it is not shown as theirs. -->
        <div class="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('app.channels.effective.title', 'What someone actually follows')}</h3>
          <p class="mt-1 max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">
            {t('app.channels.effective.explainer', 'One row per channel: the setting that wins for them (their own row beats their agent’s, which beats everyone’s; this App’s beats the organization’s), and how far they have read.')}
          </p>
          <label class="mt-2 block max-w-sm text-xs text-zinc-600 dark:text-zinc-400">
            {t('app.channels.effective.pick', 'Show for')}
            <!-- Read from the event, so the load never depends on whether the binding
                 or this listener runs first. -->
            <select bind:value={effectiveFor} onchange={(e) => loadEffective(e.currentTarget.value)} class="mt-1 {inputClass}">
              <option value="">{t('app.channels.effective.pick.none', 'Pick a worker or agent…')}</option>
              <!-- Active attendees only, as in the add form: a retired Worker follows nothing now. -->
              {#each pickable as a (a.id)}
                <option value={a.id}>{a.kind === 'worker' ? a.name : t('app.channels.register.agent', '{name} (agent)', { name: a.name })}</option>
              {/each}
            </select>
            {#if effectiveAttendee?.urn}
              <span class="mt-1 block">
                <Urn value={effectiveAttendee.urn} type={effectiveAttendee.kind === 'worker' ? 'worker' : 'agent'} size={8} label={t('app.channels.register.urn', 'attendee')} />
              </span>
            {/if}
          </label>
          {#if effectiveState === 'loading'}
            <p class="mt-2 text-xs text-zinc-500" role="status">{t('app.channels.effective.loading', 'Loading…')}</p>
          {:else if effectiveState === 'failed'}
            <p class="mt-2 text-sm text-amber-700 dark:text-amber-300" role="alert">{t('app.channels.effective.failed', 'Couldn’t load that just now. This is an error, not an empty list. Try again.')}</p>
          {:else if effective}
            {#if effective.rows.length === 0}
              <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('app.channels.effective.empty', 'They don’t take part in any channel you can see.')}</p>
            {:else}
              <p class="mt-2 text-[11px] text-zinc-400">{t('app.channels.effective.as-of', 'As of {time}.', { time: new Date(effective.loadedAt).toLocaleTimeString() })}</p>
              <div class="mt-1">
                <DataTable
                  table={effectiveTable}
                  listKey="app:register-effective"
                  searchPlaceholder={t('app.channels.register.search', 'Search…')}
                  searchAriaLabel={t('app.channels.register.search', 'Search…')}
                  bind:globalFilter={effectiveFilter}
                >
                  {#snippet cell(cell, row)}
                    {#if cell.column.id === 'channel' && row.channelUrn}
                      <div class="min-w-0">
                        <div class="truncate">{row.channel}</div>
                        <Urn value={row.channelUrn} type="node" size={8} label={t('app.channels.urn.channel', 'channel')} />
                      </div>
                    {:else}
                      <div class="truncate">{cell.getValue()}</div>
                    {/if}
                  {/snippet}
                </DataTable>
              </div>
            {/if}
          {/if}
        </div>
      {/snippet}
    </RegisterPanel>
  </section>
</div>
