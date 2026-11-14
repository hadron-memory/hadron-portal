<!--
  hadron-portal#2134 — the signed-in person's own grants across Apps.

  The user wants to see what they have been granted, and where.
  Facts only, as the server returns them: `allows` and the timestamps. No state
  label is derived (the server has none), and no signature or ceremony fields
  are shown (display conditions 1 and 2 on the issue).
-->
<script lang="ts">
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
  import type { MyGrant } from './+page.server';

  let { data }: { data: PageData } = $props();

  const grants = $derived(data.grants as MyGrant[]);
  let globalFilter = $state('');

  const unopenable = () => t('grants.mine.app.unopenable', "An App you can't open");
  const dash = '—';
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : dash);
  const ms = (iso: string | null) => {
    const v = iso ? new Date(iso).getTime() : NaN;
    return Number.isNaN(v) ? null : v;
  };
  const allowsText = (g: MyGrant) => (g.allows ? t('grants.mine.allows.yes', 'Yes') : t('grants.mine.allows.no', 'No'));
  const valuesText = (g: MyGrant) => (g.values == null ? dash : typeof g.values === 'string' ? g.values : JSON.stringify(g.values));

  const columns: PortalColumnDef<MyGrant>[] = [
    { accessorFn: (g) => g.app?.name ?? unopenable(), id: 'app', header: t('grants.mine.col.app', 'App'), enableHiding: false, size: 240 },
    { accessorKey: 'action', header: t('grants.mine.col.action', 'Action'), size: 180 },
    { accessorFn: valuesText, id: 'values', header: t('grants.mine.col.values', 'Values'), size: 180 },
    { accessorFn: (g) => g.reason, id: 'reason', header: t('grants.mine.col.reason', 'Reason'), size: 220 },
    { accessorFn: allowsText, id: 'allows', header: t('grants.mine.col.allows', 'Allows now'), size: 110 },
    { accessorFn: (g) => ms(g.createdAt), id: 'createdAt', header: t('grants.mine.col.created', 'Requested'), size: 170 },
    { accessorFn: (g) => ms(g.activatedAt), id: 'activatedAt', header: t('grants.mine.col.activated', 'Activated'), size: 170 },
    { accessorFn: (g) => ms(g.startsAt), id: 'startsAt', header: t('grants.mine.col.starts', 'Starts'), size: 170 },
    { accessorFn: (g) => ms(g.expiresAt), id: 'expiresAt', header: t('grants.mine.col.expires', 'Expires'), size: 170 },
    { accessorFn: (g) => g.revokedAt && ms(g.revokedAt), id: 'revokedAt', header: t('grants.mine.col.revoked', 'Revoked'), size: 170 },
    { accessorFn: (g) => g.useCount, id: 'uses', header: t('grants.mine.col.uses', 'Uses'), size: 90 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    createdAt: (v) => (v == null ? dash : new Date(v as number).toLocaleString()),
    activatedAt: (v) => (v == null ? dash : new Date(v as number).toLocaleString()),
    startsAt: (v) => (v == null ? dash : new Date(v as number).toLocaleString()),
    expiresAt: (v) => (v == null ? dash : new Date(v as number).toLocaleString()),
    revokedAt: (v) => (v == null ? dash : new Date(v as number).toLocaleString()),
  };

  const table = createSvelteTable<MyGrant>({
    get data() {
      return grants;
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
    globalFilterFn: makeGlobalFilterFn<MyGrant>(fmt, {}),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
  });
</script>

<section class="space-y-3" aria-labelledby="my-grants-title">
  <h2 id="my-grants-title" class="text-lg font-semibold text-zinc-900 dark:text-white">
    {t('grants.mine.title', 'Your grants')}
  </h2>

  {#if data.unavailable}
    <p class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="my-grants-unavailable">
      {t('grants.mine.impersonating', 'Grants are not available while you are signed in as someone else.')}
    </p>
  {:else if grants.length === 0}
    <p class="text-sm text-zinc-600 dark:text-zinc-400" data-testid="my-grants-empty">
      {t('grants.mine.empty', 'You have no grants.')}
    </p>
  {:else}
    <DataTable
      {table}
      listKey="account:grants"
      searchPlaceholder={t('grants.mine.search', 'Search grants')}
      searchAriaLabel={t('grants.mine.search', 'Search grants')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 20rem))"
      rowAttrs={(g) => ({ 'data-testid': 'my-grant-row', 'data-grant-id': g.id })}
    >
      {#snippet cell(cell, g)}
        {#if cell.column.id === 'app'}
          {#if g.app}
            <div class="truncate">{g.app.name}</div>
            <div class="mt-1"><Urn value={g.app.urn} type="app" /></div>
          {:else}
            <div class="truncate text-zinc-500 dark:text-zinc-400">{unopenable()}</div>
            <div class="mt-1 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400" data-testid="my-grant-app-id">{g.appId}</div>
          {/if}
        {:else if cell.column.id in fmt}
          {fmt[cell.column.id](cell.getValue())}
        {:else}
          {String(cell.getValue() ?? dash)}
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</section>
