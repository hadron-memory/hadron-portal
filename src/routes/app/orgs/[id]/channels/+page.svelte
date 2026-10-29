<script lang="ts">
  // #942 — an organization's Channels and its own register rows. The rows set
  // here apply across the org's Apps (an App's own row for the same Channel
  // and attendee wins over them). They are managed here, and shown read-only
  // on each App's Channels page.
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import RegisterPanel from '$lib/components/register/RegisterPanel.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { t } from '$lib/i18n/t';
  import type { Channel } from '$lib/types';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  interface Row {
    channel: Channel;
    id: string;
    name: string;
    /** The address as shown: the URN when there is one, else the id. */
    address: string;
    host: string;
  }
  const rows = $derived<Row[]>(
    data.channels.map((c) => ({
      channel: c,
      id: c.id,
      name: c.name,
      // A compound (pre-v2) host memory has no chatRootUrn, and its loc is only
      // memory-relative, so the id is the address there.
      address: c.chatRootUrn ?? c.id,
      // #2509: seeing a Channel does not grant its host memory's record, so
      // memory may be null — the host cell then renders the withheld note.
      host: c.memory?.name ?? '',
    })),
  );

  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    // Search matches what the cells show: the name and description, the
    // address, and the memory's name and URN.
    { accessorFn: (r) => [r.name, r.channel.description].filter(Boolean).join(' '), id: 'name', header: t('org.channels.col.name', 'Channel'), enableHiding: false, size: 240 },
    { accessorKey: 'address', header: t('org.channels.col.address', 'Address'), size: 320 },
    { accessorFn: (r) => `${r.host} ${r.channel.memory?.urn ?? ''}`, id: 'host', header: t('org.channels.col.host', 'Lives in memory'), size: 260 },
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
</script>

<svelte:head><title>{t('org.channels.head', 'Channels')} · {data.org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">{t('org.channels.title', 'Channels')}</h1>
    <p class="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
      {t(
        'org.channels.explainer',
        'The channels in this organization’s memories, and who takes part in them across all its Apps. A channel adds no access of its own: who can read it and post to it is decided by the memory it lives in.',
      )}
    </p>
  </div>

  <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('org.channels.list.title', 'Channels in this organization')}</h2>
    {#if rows.length === 0}
      <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t('org.channels.empty', 'No channels you can read in this organization yet.')}</p>
    {:else}
      <div class="mt-3">
        <DataTable
          {table}
          listKey="org:channels"
          searchPlaceholder={t('org.channels.search', 'Search channels…')}
          searchAriaLabel={t('org.channels.search', 'Search channels…')}
          bind:globalFilter
          maxHeight="max(200px, calc(100vh - 34rem))"
        >
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'name'}
              <div class="min-w-0">
                <a href="/app/memories/{row.channel.memoryId}/nodes/{row.channel.chatRootNodeId}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.name}</a>
                {#if row.channel.description}<div class="truncate text-xs text-zinc-500 dark:text-zinc-400">{row.channel.description}</div>{/if}
              </div>
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
                  <span class="text-xs text-zinc-500 dark:text-zinc-400" title={t('org.channels.host-hidden-title', 'Seeing this channel doesn’t grant its memory’s record.')}>{t('org.channels.host-hidden', 'Memory not shown')}</span>
                {/if}
              </div>
            {:else}
              <div class="truncate">{cell.getValue()}</div>
            {/if}
          {/snippet}
        </DataTable>
      </div>
    {/if}
  </section>

  <!-- The organization's own register rows. A row says who TAKES PART; it
       never grants access. -->
  <section class="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
    <div>
      <h2 class="text-sm font-semibold text-zinc-900 dark:text-white">{t('org.channels.register.title', 'Who takes part, across the organization')}</h2>
      <p class="mt-1 max-w-3xl text-xs text-zinc-500 dark:text-zinc-400">
        {t(
          'org.channels.register.explainer',
          'Rows set here apply in every App of this organization; an App’s own row for the same channel and person wins. Watch means new messages count for them; Post means they’re expected to write there; both is the default. This records who takes part. It doesn’t give anyone access.',
        )}
      </p>
    </div>
    {#if data.rosterFailed}
      <p role="status" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        {t('org.channels.roster-failed', 'Couldn’t load this organization’s workers and agents just now, so only “Everyone in the organization” is offered below. The rows themselves are all shown.')}
      </p>
    {:else if data.rosterUnreadApps > 0}
      <p role="status" class="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
        {t('org.channels.roster-partial', 'Couldn’t load the workers and agents of {count} App(s) just now, so they aren’t offered below. The rows themselves are all shown.', { count: String(data.rosterUnreadApps) })}
      </p>
    {/if}
    {#if data.rosterWithheldApps > 0}
      <p role="status" class="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300">
        {t('org.channels.roster-withheld', 'The agents installed in {count} App(s) aren’t visible to you, so they aren’t offered below.', { count: String(data.rosterWithheldApps) })}
      </p>
    {/if}
    <RegisterPanel
      rows={data.orgRows}
      ownerType="ORGANIZATION"
      ownerId={data.org.id}
      canManage={data.canManageRegister}
      channels={data.channels}
      attendees={data.attendees}
      addForm={data.addAttendanceForm}
      editForm={data.editAttendanceForm}
      removeForm={data.removeAttendanceForm}
      actionData={form}
      listKey="org:register"
      loadFailed={data.registerLoadFailed}
    />
  </section>
</div>
