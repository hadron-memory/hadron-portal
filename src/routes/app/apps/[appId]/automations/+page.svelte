<script lang="ts">
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { approvalHref, listStateLabel, type ApprovalRow } from '$lib/automation/approval';
  import { timingFromSchedule, timingSentence } from '$lib/automation/schedule-timing';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  /**
   * portal#1299 — the App's schedules and webhooks an adopter can approve.
   * Two states only: the server's list never says "changed" (that is computed
   * when one is opened) and never says "up to date". A reader who may not
   * adopt gets an empty page from the server and sees nothing that says what
   * is unapproved: no state, no count.
   */
  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const rows = $derived<ApprovalRow[]>(data.approvals.rows);
  // portal#1701: a schedule row says when it runs in a plain sentence, in the schedule's own zone. The server's
  // headline for a schedule quotes its cron, so a schedule row never shows it: with no matching schedule (a reader who
  // may not read schedules) the row simply has no timing.
  const scheduleById = $derived(new Map(data.schedules.schedules.map((s) => [s.id, s])));
  function subtitle(r: ApprovalRow): string {
    if (r.triggerKind !== 'SCHEDULE') return r.headline;
    const s = scheduleById.get(r.triggerRef);
    if (!s) return '';
    const timing = timingFromSchedule(s);
    const when = timing ? timingSentence(timing, s.timezone) : '';
    return s.enabled ? when : [t('app.automations.paused', 'Paused'), when].filter(Boolean).join(' · ');
  }
  const manualOmitted = $derived(data.approvals.omitted.some((o) => o.triggerKind === 'MANUAL'));

  const kindLabel = (kind: ApprovalRow['triggerKind']) =>
    kind === 'WEBHOOK' ? t('app.automations.kind.webhook', 'Webhook') : kind === 'SCHEDULE' ? t('app.automations.kind.schedule', 'Schedule') : t('app.automations.kind.manual', 'Manual run');

  let globalFilter = $state('');
  // Search reaches everything the row shows: the name, the server's sentence, the type and the status.
  const columns: PortalColumnDef<ApprovalRow>[] = [
    { id: 'name', accessorFn: (r) => `${r.name} ${subtitle(r)}`, header: t('app.automations.col.name', 'Automation'), enableHiding: false, size: 360 },
    { id: 'kind', accessorFn: (r) => kindLabel(r.triggerKind), header: t('app.automations.col.kind', 'Starts'), size: 120 },
    { id: 'state', accessorFn: (r) => listStateLabel(r.state), header: t('app.automations.col.state', 'Status'), size: 180 },
  ];
  const table = createSvelteTable<ApprovalRow>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 50 }, sorting: [] },
  });
</script>

<svelte:head><title>{t('app.automations.head', 'Automations')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('app.automations.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.automations.crumb.automations', 'Automations') },
  ]} />

  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
        <span class="font-normal text-zinc-400">{t('app.automations.title.prefix', 'Automations:')}</span> {data.app.name}
      </h1>
      <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {t('app.automations.intro', 'A schedule or a webhook starts work on its own. It runs only once it is approved; a schedule you create here is approved by creating it.')}
      </p>
    </div>
    <!-- Offered to everyone: the server decides who may create (an organization admin), and the refusal is in plain words. -->
    <a href="{basePath}/automations/new-schedule" class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">{t('app.automations.new-schedule', 'New schedule')}</a>
  </div>

  {#if rows.length === 0}
    <div role="status" class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-6 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300" data-testid="automations-empty">
      {t('app.automations.empty', 'Nothing to review here.')}
    </div>
  {:else}
    <DataTable
      {table}
      listKey="app-automations"
      searchPlaceholder={t('app.automations.search', 'Search automations…')}
      searchAriaLabel={t('app.automations.search', 'Search automations…')}
      bind:globalFilter
    >
      {#snippet cell(cell, row)}
        {#if cell.column.id === 'name'}
          <div class="flex min-w-0 flex-col">
            <a href={approvalHref(data.app.id, row.triggerKind, row.triggerRef)} class="truncate font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.name}</a>
            {#if subtitle(row)}
              <span class="truncate text-xs text-zinc-500 dark:text-zinc-400" title={subtitle(row)}>{subtitle(row)}</span>
            {/if}
          </div>
        {:else if cell.column.id === 'kind'}
          <span class="whitespace-nowrap">{kindLabel(row.triggerKind)}</span>
        {:else if cell.column.id === 'state'}
          <span
            class="rounded-full px-2 py-0.5 text-xs font-medium {row.state === 'ADOPTED'
              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}"
          >{listStateLabel(row.state)}</span>
        {/if}
      {/snippet}
    </DataTable>
  {/if}

  <!-- The server's own cursor decides whether there is more: a short page is not the end (hrn:node:hadronmemory.com:hadron-portal:review:short-page-is-not-end-of-data). -->
  {#if data.after || data.approvals.nextCursor}
    <nav class="flex items-center gap-3 text-sm" aria-label={t('app.automations.paging', 'Pages')}>
      {#if data.after}
        <a href="{basePath}/automations" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{t('app.automations.first-page', 'First page')}</a>
      {/if}
      {#if data.approvals.nextCursor}
        <a href="{basePath}/automations?after={encodeURIComponent(data.approvals.nextCursor)}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{t('app.automations.next-page', 'Next page')}</a>
      {/if}
    </nav>
  {/if}

  {#if manualOmitted}
    <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.automations.manual', 'Manual runs are approved from the run that needs them.')}</p>
  {/if}
</div>
