<script lang="ts">
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { pageClaims, rowKind, type RegisterEntry, type RegisterPage } from '$lib/action-register/present';
  import { t } from '$lib/i18n/t';

  /**
   * portal#1649 — one server page of the action-register index, in both views.
   * The code shows on every row in every state. An empty page says "No codes
   * shown" and nothing more: the server does not tell no-Team-Agent, two Team
   * Agents, an unreadable chain and no mappings apart (ruling 0107 A), so
   * neither may this page. `definitionUrn` set means the role view, where only
   * an exact taskUrn match says "sends work here".
   */
  let {
    page,
    offset,
    limit,
    definitionUrn = null,
    hrefFor,
    listKey,
    nextStep = '',
  }: {
    page: RegisterPage;
    offset: number;
    limit: number;
    definitionUrn?: string | null;
    hrefFor: (offset: number) => string;
    listKey: string;
    /** What to do from an empty first page; a neutral step, never a cause (ruling 0107 A). */
    nextStep?: string;
  } = $props();

  const claims = $derived(pageClaims({ offset, limit, total: page.total, hasMore: page.hasMore }));

  const columns: PortalColumnDef<RegisterEntry>[] = [
    { id: 'code', accessorFn: (r) => r.code, header: t('action-register.col.code', 'Code'), enableHiding: false, enableSorting: false, size: 120 },
    { id: 'resolves', accessorFn: (r) => r.state, header: t('action-register.col.resolves', 'Resolves to'), enableSorting: false, size: 320 },
    { id: 'definedBy', accessorFn: (r) => r.definedBy ?? '', header: t('action-register.col.defined-by', 'Defined by'), enableSorting: false, size: 260 },
  ];
  // The server's order is the order: no client sorting, and one table page holds
  // the whole server page so no second pager appears beside Previous/Next.
  const table = createSvelteTable<RegisterEntry>({
    get data() { return page.entries; },
    columns,
    getRowId: (r) => r.code,
    enableSorting: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    initialState: { pagination: { pageIndex: 0, pageSize: 1000 } },
  });
</script>

{#if page.entries.length === 0}
  <div class="space-y-2 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-testid="register-empty">
    <p>{t('action-register.empty', 'No codes shown')}</p>
    {#if nextStep && claims.prevOffset === null}<p>{nextStep}</p>{/if}
    {#if claims.prevOffset !== null}
      <a href={hrefFor(claims.prevOffset)} rel="prev" class="inline-block min-h-6 font-medium text-indigo-600 underline dark:text-indigo-300">{t('action-register.previous', 'Previous')}</a>
    {/if}
  </div>
{:else}
  <DataTable {table} {listKey} showSearch={false} showFooter={false} searchPlaceholder="" searchAriaLabel="">
    {#snippet cell(cell, row)}
      {@const kind = rowKind(row, definitionUrn)}
      {#if cell.column.id === 'code'}
        <code class="font-mono text-xs" data-testid="register-code">{row.code}</code>
      {:else if cell.column.id === 'resolves'}
        <div class="flex min-w-0 flex-col gap-1" data-testid="register-row-{kind}">
          {#if kind === 'sends-here'}
            <span class="font-medium text-emerald-700 dark:text-emerald-300">{t('action-register.sends-here', 'Sends work here')}</span>
          {:else if kind === 'resolves-elsewhere'}
            <span class="font-medium text-amber-700 dark:text-amber-300">{t('action-register.resolves-elsewhere', 'Resolves to another task')}</span>
          {:else if kind === 'unresolved'}
            <span>{t('action-register.unresolved', 'No runnable task at {loc}', { loc: row.taskLoc ?? '' })}</span>
          {:else if kind === 'unmapped'}
            <span>{t('action-register.unmapped', 'The nearest register entry for this code is malformed')}</span>
          {:else if kind === 'unknown'}
            <span>{t('action-register.unknown', 'This state isn’t recognised')}</span>
          {/if}
          {#if (kind === 'mapped' || kind === 'sends-here' || kind === 'resolves-elsewhere') && row.taskUrn}
            {#if row.taskLoc}<span class="truncate font-mono text-xs">{row.taskLoc}</span>{/if}
            <Urn value={row.taskUrn} type="node" compact linked label={t('action-register.task', 'task')} />
          {/if}
        </div>
      {:else if cell.column.id === 'definedBy'}
        {#if row.definedBy}
          <Urn value={row.definedBy} type="agent" compact linked label={t('action-register.defined-by', 'defined by')} />
        {:else if kind === 'mapped' || kind === 'sends-here' || kind === 'resolves-elsewhere'}
          <span data-testid="register-defined-by-none" class="text-zinc-400 dark:text-zinc-500" aria-hidden="true">—</span>
          <span class="sr-only">{t('action-register.defined-by-none', 'No defining Agent')}</span>
        {/if}
      {/if}
    {/snippet}
  </DataTable>
{/if}

<nav aria-label={t('action-register.paging', 'Pages of codes')} class="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-600 dark:text-zinc-400" data-testid="register-paging">
  <span>
    {#if page.entries.length === 0}
      {#if offset > 0}{t('action-register.total', '{total} in all', { total: page.total })}{/if}
    {:else}
      {t('action-register.range', 'Showing {from}–{to} of {total}', { from: offset + 1, to: offset + page.entries.length, total: page.total })}
    {/if}
  </span>
  <span class="flex gap-3">
    {#if claims.prevOffset !== null && page.entries.length > 0}
      <a href={hrefFor(claims.prevOffset)} rel="prev" class="inline-flex min-h-6 items-center font-medium text-indigo-600 underline dark:text-indigo-300">{t('action-register.previous', 'Previous')}</a>
    {/if}
    {#if claims.nextOffset !== null}
      <a href={hrefFor(claims.nextOffset)} rel="next" class="inline-flex min-h-6 items-center font-medium text-indigo-600 underline dark:text-indigo-300">{t('action-register.next', 'Next')}</a>
    {/if}
  </span>
</nav>
